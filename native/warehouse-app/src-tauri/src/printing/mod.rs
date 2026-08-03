#[cfg(windows)]
mod win_spooler;

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Raw ZPL is delivered either straight to a networked printer (JetDirect, the
/// de-facto raw port 9100) or through a Windows spooler queue in RAW
/// pass-through mode for a USB-attached Zebra.
#[derive(Debug, PartialEq)]
pub enum PrintTarget {
    Tcp { host: String, port: u16 },
    Spooler { name: String },
}

/// Default JetDirect raw port, used when `tcp://` carries no explicit port.
const DEFAULT_RAW_PORT: u16 = 9100;
/// Fail in front of the operator rather than hanging on the OS default connect
/// timeout (~2 min) when a printer IP is wrong or the device is powered off.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// Parse a printer target: `tcp://<host>[:<port>]` (IPv6 literals bracketed, as
/// in `tcp://[::1]:9100`) or `spooler://<queue-name>`.
pub fn parse_target(s: &str) -> Result<PrintTarget, String> {
    if let Some(rest) = s.strip_prefix("tcp://") {
        let (host, port) = split_host_port(rest)?;
        if host.is_empty() {
            return Err("empty host".into());
        }
        Ok(PrintTarget::Tcp { host, port })
    } else if let Some(name) = s.strip_prefix("spooler://") {
        if name.is_empty() {
            return Err("empty printer name".into());
        }
        Ok(PrintTarget::Spooler {
            name: name.to_string(),
        })
    } else {
        Err(format!("unrecognized target: {s}"))
    }
}

fn split_host_port(rest: &str) -> Result<(String, u16), String> {
    // Bracketed IPv6 first: its host part is full of colons, so the plain
    // rsplit below would mistake the address tail for a port.
    if let Some(after_bracket) = rest.strip_prefix('[') {
        let (host, tail) = after_bracket
            .split_once(']')
            .ok_or("unterminated IPv6 literal")?;
        let port = match tail {
            "" => DEFAULT_RAW_PORT,
            t => parse_port(t.strip_prefix(':').ok_or("bad port")?)?,
        };
        return Ok((host.to_string(), port));
    }
    match rest.rsplit_once(':') {
        Some((host, port)) => Ok((host.to_string(), parse_port(port)?)),
        None => Ok((rest.to_string(), DEFAULT_RAW_PORT)),
    }
}

fn parse_port(s: &str) -> Result<u16, String> {
    s.parse::<u16>().map_err(|_| "bad port".to_string())
}

fn send_tcp(host: &str, port: u16, data: &[u8]) -> Result<(), String> {
    // Resolve first: `TcpStream::connect` takes no timeout, only `connect_timeout`
    // does, and that one needs a resolved SocketAddr.
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("resolve {host}:{port} failed: {e}"))?
        .next()
        .ok_or_else(|| format!("no address for {host}:{port}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("connect {host}:{port} failed: {e}"))?;
    stream
        .set_write_timeout(Some(WRITE_TIMEOUT))
        .map_err(|e| e.to_string())?;
    stream
        .write_all(data)
        .map_err(|e| format!("write to {host}:{port} failed: {e}"))?;
    stream.flush().map_err(|e| e.to_string())
}

#[cfg(windows)]
fn send_spooler(name: &str, data: &[u8]) -> Result<(), String> {
    win_spooler::print_raw(name, data)
}

#[cfg(not(windows))]
fn send_spooler(_name: &str, _data: &[u8]) -> Result<(), String> {
    Err("spooler printing is only available on Windows".into())
}

/// Send already-rendered bytes (ZPL, built in TS) to a printer. Declared
/// `async` so the blocking socket/spooler write runs on Tauri's threadpool
/// instead of freezing the webview's main thread.
#[tauri::command(async)]
pub fn print_raw(target: String, data: Vec<u8>) -> Result<(), String> {
    if data.is_empty() {
        return Err("nothing to print".into());
    }
    match parse_target(&target)? {
        PrintTarget::Tcp { host, port } => send_tcp(&host, port, &data),
        PrintTarget::Spooler { name } => send_spooler(&name, &data),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn parses_tcp_with_port() {
        assert_eq!(
            parse_target("tcp://192.168.0.10:9100").unwrap(),
            PrintTarget::Tcp {
                host: "192.168.0.10".into(),
                port: 9100
            }
        );
    }

    #[test]
    fn tcp_defaults_port_9100() {
        assert_eq!(
            parse_target("tcp://192.168.0.10").unwrap(),
            PrintTarget::Tcp {
                host: "192.168.0.10".into(),
                port: 9100
            }
        );
    }

    #[test]
    fn parses_hostname_target() {
        assert_eq!(
            parse_target("tcp://zebra-pack-01.local:6101").unwrap(),
            PrintTarget::Tcp {
                host: "zebra-pack-01.local".into(),
                port: 6101
            }
        );
    }

    #[test]
    fn parses_bracketed_ipv6_with_and_without_port() {
        assert_eq!(
            parse_target("tcp://[fe80::1]:9100").unwrap(),
            PrintTarget::Tcp {
                host: "fe80::1".into(),
                port: 9100
            }
        );
        assert_eq!(
            parse_target("tcp://[fe80::1]").unwrap(),
            PrintTarget::Tcp {
                host: "fe80::1".into(),
                port: 9100
            }
        );
    }

    #[test]
    fn parses_spooler() {
        assert_eq!(
            parse_target("spooler://ZebraZP450").unwrap(),
            PrintTarget::Spooler {
                name: "ZebraZP450".into()
            }
        );
    }

    #[test]
    fn rejects_unknown_scheme() {
        assert!(parse_target("http://x").is_err());
        assert!(parse_target("192.168.0.10:9100").is_err());
    }

    #[test]
    fn rejects_empty_host_or_name() {
        assert!(parse_target("tcp://").is_err());
        assert!(parse_target("tcp://:9100").is_err());
        assert!(parse_target("spooler://").is_err());
    }

    #[test]
    fn rejects_bad_port() {
        assert!(parse_target("tcp://192.168.0.10:0x1f").is_err());
        assert!(parse_target("tcp://192.168.0.10:70000").is_err());
    }

    /// Stands in for the printer's raw 9100 socket: whatever we hand `print_raw`
    /// must arrive byte-identical, since the printer parses it as ZPL.
    #[test]
    fn send_tcp_delivers_the_bytes_verbatim() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let received = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            stream.read_to_end(&mut buf).unwrap();
            buf
        });

        let zpl = b"^XA^FO50,50^FDTEST^FS^XZ";
        print_raw(format!("tcp://127.0.0.1:{port}"), zpl.to_vec()).unwrap();

        assert_eq!(received.join().unwrap(), zpl);
    }

    #[test]
    fn rejects_an_empty_job() {
        assert!(print_raw("tcp://127.0.0.1:9100".into(), Vec::new()).is_err());
    }
}
