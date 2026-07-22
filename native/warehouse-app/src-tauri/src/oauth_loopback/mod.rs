/// Parse `code` and `state` out of an HTTP request line such as
/// `GET /callback?code=abc&state=xyz HTTP/1.1`. Errors if the OAuth server
/// returned an `error=` param, or if `code`/`state` are missing.
pub fn parse_callback_request_line(line: &str) -> Result<(String, String), String> {
    // request line: METHOD SP request-target SP HTTP-version
    let target = line.split(' ').nth(1).ok_or("malformed request line")?;
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    for pair in query.split('&') {
        let Some((k, v)) = pair.split_once('=') else {
            continue;
        };
        let val = percent_decode(v);
        match k {
            "error" => return Err(format!("OAuth error: {val}")),
            "code" => code = Some(val),
            "state" => state = Some(val),
            _ => {}
        }
    }
    match (code, state) {
        (Some(c), Some(s)) if !c.is_empty() && !s.is_empty() => Ok((c, s)),
        _ => Err("callback missing code/state".into()),
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < b.len() => {
                let hi = (b[i + 1] as char).to_digit(16);
                let lo = (b[i + 2] as char).to_digit(16);
                match (hi, lo) {
                    (Some(h), Some(l)) => {
                        out.push((h * 16 + l) as u8);
                        i += 3;
                    }
                    _ => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::sync::oneshot;

/// Port → receiver for the single callback that loopback listener will deliver.
#[derive(Default)]
pub struct LoopbackState {
    pending: Mutex<HashMap<u16, oneshot::Receiver<Result<(String, String), String>>>>,
}

#[derive(Serialize)]
pub struct StartResult {
    pub port: u16,
}

#[derive(Serialize)]
pub struct Callback {
    pub code: String,
    pub state: String,
}

/// Bind an ephemeral loopback port and spawn a one-shot listener thread.
#[tauri::command]
pub async fn oauth_loopback_start(
    state: State<'_, LoopbackState>,
) -> Result<StartResult, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, rx) = oneshot::channel();
    // Blocking accept on a dedicated thread; deliver the parsed result via the channel.
    std::thread::spawn(move || {
        let _ = tx.send(accept_one(&listener));
    });
    // Watchdog: if nobody connects within 120s (matching oauth_loopback_wait's own
    // timeout), nudge the still-blocked accept() with a dummy connection so its
    // thread can read garbage, fail to parse, and exit — freeing the thread and port.
    // On a completed login the listener is already dropped, so this connect just
    // fails harmlessly (nothing bound to `port` anymore).
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        let _ = std::net::TcpStream::connect(("127.0.0.1", port));
    });
    state
        .pending
        .lock()
        .map_err(|_| "loopback state poisoned")?
        .insert(port, rx);
    Ok(StartResult { port })
}

/// Await the callback for `port` (120s timeout).
#[tauri::command]
pub async fn oauth_loopback_wait(
    state: State<'_, LoopbackState>,
    port: u16,
) -> Result<Callback, String> {
    let rx = {
        let mut pending = state.pending.lock().map_err(|_| "loopback state poisoned")?;
        pending
            .remove(&port)
            .ok_or("no pending loopback listener for that port")?
    };
    let received = tokio::time::timeout(Duration::from_secs(120), rx)
        .await
        .map_err(|_| "login timed out".to_string())?
        .map_err(|_| "loopback listener dropped".to_string())?;
    let (code, st) = received?;
    Ok(Callback { code, state: st })
}

/// Accept exactly one connection, parse its request line, and reply with a small page.
fn accept_one(listener: &TcpListener) -> Result<(String, String), String> {
    let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(120))).ok();
    let mut buf = [0u8; 2048];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf[..n]);
    let first_line = text.lines().next().unwrap_or("");
    let parsed = parse_callback_request_line(first_line);
    let body = if parsed.is_ok() {
        "<html><body>Login complete — you can close this tab.</body></html>"
    } else {
        "<html><body>Login failed — you can close this tab.</body></html>"
    };
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_code_and_state() {
        assert_eq!(
            parse_callback_request_line("GET /callback?code=abc&state=xyz HTTP/1.1").unwrap(),
            ("abc".to_string(), "xyz".to_string())
        );
    }

    #[test]
    fn errors_on_oauth_error_param() {
        assert!(parse_callback_request_line("GET /callback?error=access_denied HTTP/1.1").is_err());
    }

    #[test]
    fn errors_when_code_or_state_missing() {
        assert!(parse_callback_request_line("GET /callback?code=abc HTTP/1.1").is_err());
    }

    #[test]
    fn errors_on_empty_code_or_state() {
        assert!(parse_callback_request_line("GET /callback?code=&state=xyz HTTP/1.1").is_err());
    }

    #[test]
    fn percent_decodes_values() {
        assert_eq!(
            parse_callback_request_line("GET /callback?code=a%20b&state=x%2By HTTP/1.1").unwrap(),
            ("a b".to_string(), "x+y".to_string())
        );
    }
}
