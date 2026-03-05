use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct SetupProgress {
    pub current_step: String,
    pub percentage: u8,
    pub message: String,
    pub is_error: bool,
}

/// Check if Homebrew is installed
#[tauri::command]
pub async fn check_homebrew_installed() -> Result<bool, String> {
    let output = Command::new("which")
        .arg("brew")
        .output()
        .map_err(|e| format!("Failed to check Homebrew: {}", e))?;

    Ok(output.status.success())
}

/// Install Homebrew
#[tauri::command]
pub async fn install_homebrew() -> Result<String, String> {
    // Security: Use the official Homebrew installation method
    // The user should be warned that this will download and execute a script
    let install_url = "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh";

    let output = Command::new("/bin/bash")
        .args([
            "-c",
            &format!(r#"curl -fsSL {} | /bin/bash"#, install_url),
        ])
        .output()
        .map_err(|e| format!("Failed to install Homebrew: {}", e))?;

    if output.status.success() {
        Ok("Homebrew installed successfully".to_string())
    } else {
        Err(format!(
            "Failed to install Homebrew: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Check if a command exists
#[tauri::command]
pub async fn check_command_exists(command: String) -> Result<bool, String> {
    let output = Command::new("which")
        .arg(&command)
        .output()
        .map_err(|e| format!("Failed to check {}: {}", command, e))?;

    Ok(output.status.success())
}

/// Install a package via Homebrew
#[tauri::command]
pub async fn brew_install(package: String) -> Result<String, String> {
    let output = Command::new("brew")
        .args(["install", &package])
        .output()
        .map_err(|e| format!("Failed to install {}: {}", package, e))?;

    if output.status.success() {
        Ok(format!("{} installed successfully", package))
    } else {
        Err(format!(
            "Failed to install {}: {}",
            package,
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Install a Homebrew cask
#[tauri::command]
pub async fn brew_install_cask(cask: String) -> Result<String, String> {
    let output = Command::new("brew")
        .args(["install", "--cask", &cask])
        .output()
        .map_err(|e| format!("Failed to install {}: {}", cask, e))?;

    if output.status.success() {
        Ok(format!("{} installed successfully", cask))
    } else {
        Err(format!(
            "Failed to install {}: {}",
            cask,
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Clone a git repository
#[tauri::command]
pub async fn clone_repository(url: String, destination: String) -> Result<String, String> {
    // Validate URL format
    if !url.starts_with("https://") && !url.starts_with("git@") {
        return Err("Invalid repository URL format".to_string());
    }

    // Check if git is installed
    let git_check = Command::new("which")
        .arg("git")
        .output()
        .map_err(|e| format!("Failed to check for git: {}", e))?;

    if !git_check.status.success() {
        return Err("Git is not installed".to_string());
    }

    let output = Command::new("git")
        .args(["clone", &url, &destination])
        .output()
        .map_err(|e| format!("Failed to clone repository: {}", e))?;

    if output.status.success() {
        Ok(format!("Repository cloned to {}", destination))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to clone repository: {}", stderr))
    }
}

/// Run npm install in a directory
#[tauri::command]
pub async fn npm_install(directory: String) -> Result<String, String> {
    // Verify directory exists
    if !std::path::Path::new(&directory).exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }

    // Check if package.json exists
    let package_json = format!("{}/package.json", directory);
    if !std::path::Path::new(&package_json).exists() {
        return Err(format!("package.json not found in {}", directory));
    }

    let output = Command::new("npm")
        .args(["install"])
        .current_dir(&directory)
        .output()
        .map_err(|e| format!("Failed to run npm install: {}", e))?;

    if output.status.success() {
        Ok("Dependencies installed successfully".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to install dependencies: {}", stderr))
    }
}

/// Run npm build in a directory
#[tauri::command]
pub async fn npm_build(directory: String) -> Result<String, String> {
    let output = Command::new("npm")
        .args(["run", "build"])
        .current_dir(&directory)
        .output()
        .map_err(|e| format!("Failed to run npm build: {}", e))?;

    if output.status.success() {
        Ok("Build completed successfully".to_string())
    } else {
        Err(format!(
            "Failed to build: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Pull an Ollama model
#[tauri::command]
pub async fn ollama_pull_model(model: String) -> Result<String, String> {
    let output = Command::new("ollama")
        .args(["pull", &model])
        .output()
        .map_err(|e| format!("Failed to pull model: {}", e))?;

    if output.status.success() {
        Ok(format!("Model {} pulled successfully", model))
    } else {
        Err(format!(
            "Failed to pull model {}: {}",
            model,
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Check if the sovereign user exists
#[tauri::command]
pub async fn check_sovereign_user_exists() -> Result<bool, String> {
    let output = Command::new("id")
        .arg("sovereign")
        .output()
        .map_err(|e| format!("Failed to check user: {}", e))?;

    Ok(output.status.success())
}

/// Trigger the privileged installer pkg
#[tauri::command]
pub async fn run_privileged_installer(pkg_path: String) -> Result<String, String> {
    // Use osascript to trigger admin authentication and run the installer
    let script = format!(
        r#"do shell script "installer -pkg '{}' -target /" with administrator privileges"#,
        pkg_path
    );

    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("Failed to run installer: {}", e))?;

    if output.status.success() {
        Ok("Privileged setup completed successfully".to_string())
    } else {
        Err(format!(
            "Failed to run installer: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
