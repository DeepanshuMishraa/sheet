fn main() {
    for icon in [
        "app-icon.png",
        "icons/icon.png",
        "icons/icon.icns",
        "icons/icon.ico",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }
    tauri_build::build()
}
