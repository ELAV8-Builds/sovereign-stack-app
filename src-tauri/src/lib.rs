mod commands;

use commands::setup::*;
use commands::services::*;
use commands::system::*;
use commands::docker::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // System commands
            run_preflight_checks,
            get_system_info,
            execute_shell_command,
            // Service commands
            get_services_status,
            start_service,
            stop_service,
            restart_service,
            get_service_logs,
            // Setup commands
            check_homebrew_installed,
            install_homebrew,
            check_command_exists,
            brew_install,
            brew_install_cask,
            clone_repository,
            npm_install,
            npm_build,
            ollama_pull_model,
            check_sovereign_user_exists,
            run_privileged_installer,
            // Docker stack commands
            check_docker_status,
            clone_docker_stack,
            configure_docker_env,
            docker_compose_build,
            docker_compose_up,
            docker_compose_down,
            pull_ollama_model,
            check_stack_health,
            get_docker_ps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
