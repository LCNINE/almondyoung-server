//! Windows RAW spooler pass-through. `RAW` is the whole point: the queue hands
//! our bytes to the printer untouched, so the ZPL we render in TS reaches the
//! Zebra instead of being re-rendered by a driver. Compiled only on Windows —
//! `printing::send_spooler` has the stub for the other platforms.

use windows::core::{Error, PCWSTR, PWSTR};
use windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW, StartPagePrinter,
    WritePrinter, DOC_INFO_1W, PRINTER_HANDLE,
};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Owns the queue handle so it is closed on every exit path, error ones included.
struct Printer(PRINTER_HANDLE);

impl Printer {
    fn open(name: &str) -> Result<Self, String> {
        let name_w = wide(name);
        let mut handle = PRINTER_HANDLE::default();
        // SAFETY: `name_w` is NUL-terminated and outlives the call; `handle` is a
        // valid out-param.
        unsafe { OpenPrinterW(PCWSTR(name_w.as_ptr()), &mut handle, None) }
            .map_err(|e| format!("cannot open printer '{name}': {e}"))?;
        Ok(Self(handle))
    }
}

impl Drop for Printer {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful OpenPrinterW and is closed once.
        unsafe {
            let _ = ClosePrinter(self.0);
        }
    }
}

pub fn print_raw(name: &str, data: &[u8]) -> Result<(), String> {
    let len = u32::try_from(data.len()).map_err(|_| "print job too large".to_string())?;
    let printer = Printer::open(name)?;

    let mut doc_name = wide("almondwms-label");
    let mut datatype = wide("RAW");
    let doc = DOC_INFO_1W {
        pDocName: PWSTR(doc_name.as_mut_ptr()),
        pOutputFile: PWSTR::null(),
        pDatatype: PWSTR(datatype.as_mut_ptr()),
    };
    // SAFETY: `doc`'s strings are NUL-terminated and outlive the doc, which the
    // spooler only reads for the duration of this call.
    let job = unsafe { StartDocPrinterW(printer.0, 1, &doc) };
    if job == 0 {
        return Err(format!("StartDocPrinter failed: {}", Error::from_win32()));
    }

    let result = write_job(&printer, data, len);
    // End the doc even when the write failed, so the queue is not left holding a
    // half-open job that blocks the next label.
    // SAFETY: `job` was started above on this handle.
    unsafe {
        let _ = EndDocPrinter(printer.0);
    }
    result
}

fn write_job(printer: &Printer, data: &[u8], len: u32) -> Result<(), String> {
    // SAFETY: all three calls take the open handle; `data` outlives WritePrinter.
    unsafe { StartPagePrinter(printer.0) }
        .ok()
        .map_err(|e| format!("StartPagePrinter failed: {e}"))?;
    let mut written = 0u32;
    let result = unsafe {
        WritePrinter(
            printer.0,
            data.as_ptr() as *const core::ffi::c_void,
            len,
            &mut written,
        )
    }
    .ok()
    .map_err(|e| format!("WritePrinter failed: {e}"));
    unsafe {
        let _ = EndPagePrinter(printer.0);
    }
    result?;
    if written != len {
        return Err(format!("spooler accepted {written} of {len} bytes"));
    }
    Ok(())
}
