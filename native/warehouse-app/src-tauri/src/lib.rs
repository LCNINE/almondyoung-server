mod oauth_loopback;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(oauth_loopback::LoopbackState::default())
    .invoke_handler(tauri::generate_handler![
      oauth_loopback::oauth_loopback_start,
      oauth_loopback::oauth_loopback_wait
    ])
    .plugin(
            tauri_plugin_stronghold::Builder::new(|pass| {
                use argon2::{hash_raw, Config, Variant, Version};
                let config = Config {
                    variant: Variant::Argon2id,
                    version: Version::Version13,
                    lanes: 4,
                    mem_cost: 10_000,
                    time_cost: 10,
                    ..Default::default()
                };
                // Phase 0 placeholder static salt — a device-derived key is a later
                // hardening phase (see tokenStore.ts security note).
                let salt = b"almondwms-static-salt";
                hash_raw(pass.as_bytes(), salt, &config).expect("stronghold key hash failed")
            })
            .build(),
        )
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_os::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
