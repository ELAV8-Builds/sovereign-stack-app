use serde::{Deserialize, Serialize};
use std::process::Command;
use std::net::TcpStream;
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceInfo {
    pub name: String,
    pub port: Option<u16>,
    pub status: ServiceStatus,
    pub runtime: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ServiceStatus {
    Running,
    Stopped,
    Unknown,
}

/// Check if a port is listening
fn is_port_listening(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}

/// Check if a process is running via launchctl
fn is_launchd_service_running(label: &str) -> bool {
    let output = Command::new("launchctl")
        .args(["list", label])
        .output();

    match output {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

/// Get status of all Sovereign Stack services
#[tauri::command]
pub async fn get_services_status() -> Result<Vec<ServiceInfo>, String> {
    let services = vec![
        ServiceInfo {
            name: "NanoClaw".to_string(),
            port: None,
            status: if is_launchd_service_running("com.sovereign.nanoclaw") {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            },
            runtime: "Node.js".to_string(),
        },
        ServiceInfo {
            name: "LiteLLM".to_string(),
            port: Some(4000),
            status: if is_port_listening(4000) {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            },
            runtime: "Python".to_string(),
        },
        ServiceInfo {
            name: "Ollama".to_string(),
            port: Some(11434),
            status: if is_port_listening(11434) {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            },
            runtime: "Native Binary".to_string(),
        },
        ServiceInfo {
            name: "memU".to_string(),
            port: Some(8090),
            status: if is_port_listening(8090) {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            },
            runtime: "Python/uvicorn".to_string(),
        },
        ServiceInfo {
            name: "PostgreSQL".to_string(),
            port: Some(5432),
            status: if is_port_listening(5432) {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            },
            runtime: "Docker".to_string(),
        },
        ServiceInfo {
            name: "Temporal".to_string(),
            port: Some(7233),
            status: if is_port_listening(7233) {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            },
            runtime: "Docker".to_string(),
        },
        ServiceInfo {
            name: "AnythingLLM".to_string(),
            port: Some(3001),
            status: if is_port_listening(3001) {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            },
            runtime: "Docker".to_string(),
        },
    ];

    Ok(services)
}

/// Start a service via launchctl
#[tauri::command]
pub async fn start_service(service_name: String) -> Result<String, String> {
    let label = format!("com.sovereign.{}", service_name.to_lowercase());

    let output = Command::new("launchctl")
        .args(["start", &label])
        .output()
        .map_err(|e| format!("Failed to start service: {}", e))?;

    if output.status.success() {
        Ok(format!("{} started successfully", service_name))
    } else {
        Err(format!(
            "Failed to start {}: {}",
            service_name,
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Stop a service via launchctl
#[tauri::command]
pub async fn stop_service(service_name: String) -> Result<String, String> {
    let label = format!("com.sovereign.{}", service_name.to_lowercase());

    let output = Command::new("launchctl")
        .args(["stop", &label])
        .output()
        .map_err(|e| format!("Failed to stop service: {}", e))?;

    if output.status.success() {
        Ok(format!("{} stopped successfully", service_name))
    } else {
        Err(format!(
            "Failed to stop {}: {}",
            service_name,
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Restart a service via launchctl
#[tauri::command]
pub async fn restart_service(service_name: String) -> Result<String, String> {
    stop_service(service_name.clone()).await?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    start_service(service_name).await
}

/// Get logs for a service
#[tauri::command]
pub async fn get_service_logs(service_name: String, lines: usize) -> Result<String, String> {
    let log_path = format!(
        "/Users/sovereign/sovereign-stack/logs/{}.log",
        service_name.to_lowercase()
    );

    let output = Command::new("tail")
        .args(["-n", &lines.to_string(), &log_path])
        .output()
        .map_err(|e| format!("Failed to read logs: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "Failed to read logs for {}: {}",
            service_name,
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
