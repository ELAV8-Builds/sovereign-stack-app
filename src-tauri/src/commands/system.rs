use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct PreflightCheckResult {
    pub passed: bool,
    pub macos_version: String,
    pub architecture: String,
    pub available_disk_space_gb: f64,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub macos_version: String,
    pub architecture: String,
    pub hostname: String,
    pub current_user: String,
}

/// Get macOS version
fn get_macos_version() -> Result<String, String> {
    let output = Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .map_err(|e| format!("Failed to execute sw_vers: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("Failed to get macOS version".to_string())
    }
}

/// Get system architecture
fn get_architecture() -> Result<String, String> {
    let output = Command::new("uname")
        .arg("-m")
        .output()
        .map_err(|e| format!("Failed to execute uname: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("Failed to get architecture".to_string())
    }
}

/// Get available disk space in GB
fn get_available_disk_space() -> Result<f64, String> {
    let output = Command::new("df")
        .args(["-g", "/"])
        .output()
        .map_err(|e| format!("Failed to execute df: {}", e))?;

    if output.status.success() {
        let output_str = String::from_utf8_lossy(&output.stdout);
        // Parse df output (skip header, get second line, fourth column)
        let lines: Vec<&str> = output_str.lines().collect();
        if lines.len() > 1 {
            let parts: Vec<&str> = lines[1].split_whitespace().collect();
            if parts.len() > 3 {
                return parts[3]
                    .parse::<f64>()
                    .map_err(|e| format!("Failed to parse disk space: {}", e));
            }
        }
        Err("Failed to parse df output".to_string())
    } else {
        Err("Failed to get disk space".to_string())
    }
}

/// Get current hostname
fn get_hostname() -> Result<String, String> {
    let output = Command::new("hostname")
        .output()
        .map_err(|e| format!("Failed to execute hostname: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("Failed to get hostname".to_string())
    }
}

/// Get current user
fn get_current_user() -> Result<String, String> {
    let output = Command::new("whoami")
        .output()
        .map_err(|e| format!("Failed to execute whoami: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("Failed to get current user".to_string())
    }
}

/// Run pre-flight checks before installation
#[tauri::command]
pub async fn run_preflight_checks() -> Result<PreflightCheckResult, String> {
    let mut result = PreflightCheckResult {
        passed: true,
        macos_version: String::new(),
        architecture: String::new(),
        available_disk_space_gb: 0.0,
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    // Check macOS version
    match get_macos_version() {
        Ok(version) => {
            result.macos_version = version.clone();
            // Parse version to check if it's >= 13.0 (for SMAppService)
            let version_parts: Vec<&str> = version.split('.').collect();
            if let Some(major_str) = version_parts.first() {
                if let Ok(major) = major_str.parse::<u32>() {
                    if major < 13 {
                        result.warnings.push(format!(
                            "macOS version {} detected. Version 13+ recommended for best compatibility.",
                            version
                        ));
                    }
                }
            }
        }
        Err(e) => {
            result.errors.push(e);
            result.passed = false;
        }
    }

    // Check architecture (should be arm64 or x86_64)
    match get_architecture() {
        Ok(arch) => {
            result.architecture = arch.clone();
            if arch != "arm64" && arch != "x86_64" {
                result.warnings.push(format!(
                    "Unusual architecture detected: {}. Expected arm64 or x86_64.",
                    arch
                ));
            }
        }
        Err(e) => {
            result.errors.push(e);
            result.passed = false;
        }
    }

    // Check available disk space (need at least 20GB)
    match get_available_disk_space() {
        Ok(space_gb) => {
            result.available_disk_space_gb = space_gb;
            if space_gb < 20.0 {
                result.errors.push(format!(
                    "Insufficient disk space. Available: {:.1}GB. Required: 20GB minimum.",
                    space_gb
                ));
                result.passed = false;
            } else if space_gb < 50.0 {
                result.warnings.push(format!(
                    "Low disk space: {:.1}GB available. 50GB+ recommended.",
                    space_gb
                ));
            }
        }
        Err(e) => {
            result.warnings.push(format!("Could not check disk space: {}", e));
        }
    }

    Ok(result)
}

/// Get system information
#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    Ok(SystemInfo {
        macos_version: get_macos_version().unwrap_or_else(|_| "Unknown".to_string()),
        architecture: get_architecture().unwrap_or_else(|_| "Unknown".to_string()),
        hostname: get_hostname().unwrap_or_else(|_| "Unknown".to_string()),
        current_user: get_current_user().unwrap_or_else(|_| "Unknown".to_string()),
    })
}

/// Execute a shell command and return output
#[tauri::command]
pub async fn execute_shell_command(command: String, args: Vec<String>) -> Result<String, String> {
    let output = Command::new(&command)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute {}: {}", command, e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "Command failed with exit code {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
