//! A bounded UTF-8 JSON ABI. No JavaScript engine or wasm-bindgen runtime required.
use crate::api::RuntimeApi;
use std::cell::RefCell;
thread_local! {static API:RefCell<RuntimeApi>=RefCell::new(RuntimeApi::default());static OUTPUT:RefCell<Vec<u8>>=const {RefCell::new(Vec::new())};}
#[no_mangle]
pub extern "C" fn oll_alloc(length: usize) -> *mut u8 {
    if length > 16 * 1024 * 1024 {
        return std::ptr::null_mut();
    }
    Box::into_raw(vec![0u8; length].into_boxed_slice()) as *mut u8
}
#[no_mangle]
pub unsafe extern "C" fn oll_free(pointer: *mut u8, length: usize) {
    if !pointer.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            pointer, length,
        )));
    }
}
#[no_mangle]
pub unsafe extern "C" fn oll_request(pointer: *const u8, length: usize) -> *const u8 {
    let response = if pointer.is_null() || length > 16 * 1024 * 1024 {
        serde_json::json!({"ok":false,"error":"Invalid input buffer"})
    } else {
        match serde_json::from_slice(std::slice::from_raw_parts(pointer, length)) {
            Ok(request) => API.with(|api| api.borrow_mut().request(&request)),
            Err(e) => serde_json::json!({"ok":false,"error":e.to_string()}),
        }
    };
    OUTPUT.with(|out| {
        let mut out = out.borrow_mut();
        *out = serde_json::to_vec(&response).unwrap();
        out.as_ptr()
    })
}
#[no_mangle]
pub extern "C" fn oll_response_len() -> usize {
    OUTPUT.with(|out| out.borrow().len())
}
