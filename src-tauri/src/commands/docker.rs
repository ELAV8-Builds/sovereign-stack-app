use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DockerStatus {
    pub docker_installed: bool,
    pub docker_running: bool,
    pub compose_available: bool,
    pub stack_cloned: bool,
    pub stack_path: String,
    pub env_configured: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceHealth {
    pub name: String,
    pub healthy: bool,
    pub status: String, // "running", "starting", "stopped", "error"
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SetupStepResult {
    pub step: String,
    pub success: bool,
    pub message: String,
    pub detail: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────

fn get_stack_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".sovereign-stack")
}

fn run_cmd(cmd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run `{} {}`: {}", cmd, args.join(" "), e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn run_cmd_in_dir(cmd: &str, args: &[&str], dir: &PathBuf) -> Result<String, String> {
    let output = Command::new(cmd)
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run `{} {}` in {:?}: {}", cmd, args.join(" "), dir, e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(format!("{}\n{}", stderr, stdout))
    }
}

// ── Docker Detection ─────────────────────────────────────────────────

/// Check full Docker + stack status
#[tauri::command]
pub async fn check_docker_status() -> Result<DockerStatus, String> {
    let docker_installed = Command::new("docker")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let docker_running = if docker_installed {
        Command::new("docker")
            .arg("info")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        false
    };

    let compose_available = if docker_running {
        Command::new("docker")
            .args(["compose", "version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        false
    };

    let stack_dir = get_stack_dir();
    let stack_cloned = stack_dir.join("docker-compose.yml").exists();
    let env_configured = stack_dir.join(".env").exists();

    Ok(DockerStatus {
        docker_installed,
        docker_running,
        compose_available,
        stack_cloned,
        stack_path: stack_dir.to_string_lossy().to_string(),
        env_configured,
    })
}

// ── Stack Setup ──────────────────────────────────────────────────────

/// Clone the sovereign-stack-docker repository
#[tauri::command]
pub async fn clone_docker_stack() -> Result<SetupStepResult, String> {
    let stack_dir = get_stack_dir();

    // If already cloned, just pull latest
    if stack_dir.join("docker-compose.yml").exists() {
        let pull_result = run_cmd_in_dir("git", &["pull", "--ff-only"], &stack_dir);
        return Ok(SetupStepResult {
            step: "clone_stack".to_string(),
            success: true,
            message: match pull_result {
                Ok(_) => "Stack updated to latest version".to_string(),
                Err(_) => "Stack already up to date".to_string(),
            },
            detail: None,
        });
    }

    // Create parent directory
    if let Some(parent) = stack_dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Clone the repository
    let result = run_cmd(
        "git",
        &[
            "clone",
            "https://github.com/ELAV8-Builds/sovereign-stack-docker.git",
            &stack_dir.to_string_lossy(),
        ],
    );

    match result {
        Ok(_) => Ok(SetupStepResult {
            step: "clone_stack".to_string(),
            success: true,
            message: "Sovereign Stack downloaded successfully".to_string(),
            detail: Some(stack_dir.to_string_lossy().to_string()),
        }),
        Err(e) => Ok(SetupStepResult {
            step: "clone_stack".to_string(),
            success: false,
            message: "Failed to download Sovereign Stack".to_string(),
            detail: Some(e),
        }),
    }
}

/// Write the .env file with user's API key and settings
#[tauri::command]
pub async fn configure_docker_env(
    anthropic_key: String,
    openai_key: Option<String>,
    gemini_key: Option<String>,
    workspace_path: Option<String>,
) -> Result<SetupStepResult, String> {
    let stack_dir = get_stack_dir();
    let env_path = stack_dir.join(".env");

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let ws_path = workspace_path.unwrap_or_else(|| format!("{}/projects", home));

    // Build .env content
    let mut env_content = String::new();
    env_content.push_str("# Sovereign Stack — Environment Variables\n");
    env_content.push_str("# Auto-generated by Sovereign Desktop App\n\n");

    // Required API key
    env_content.push_str(&format!("ANTHROPIC_API_KEY={}\n", anthropic_key));

    // Optional keys
    if let Some(ref key) = openai_key {
        if !key.is_empty() {
            env_content.push_str(&format!("OPENAI_API_KEY={}\n", key));
        }
    }
    if let Some(ref key) = gemini_key {
        if !key.is_empty() {
            env_content.push_str(&format!("GEMINI_API_KEY={}\n", key));
        }
    }

    env_content.push_str("\n# LiteLLM Master Key\n");
    env_content.push_str("LITELLM_MASTER_KEY=sk-litellm-master\n");

    env_content.push_str(&format!("\n# Workspace Path\nWORKSPACE_PATH={}\n", ws_path));

    // Create workspace directory if it doesn't exist
    let ws = std::path::Path::new(&ws_path);
    if !ws.exists() {
        let _ = std::fs::create_dir_all(ws);
    }

    // Write the .env file
    std::fs::write(&env_path, env_content)
        .map_err(|e| format!("Failed to write .env file: {}", e))?;

    Ok(SetupStepResult {
        step: "configure_env".to_string(),
        success: true,
        message: "Configuration saved".to_string(),
        detail: Some(env_path.to_string_lossy().to_string()),
    })
}

/// Build Docker images (docker compose build)
#[tauri::command]
pub async fn docker_compose_build() -> Result<SetupStepResult, String> {
    let stack_dir = get_stack_dir();

    if !stack_dir.join("docker-compose.yml").exists() {
        return Ok(SetupStepResult {
            step: "docker_build".to_string(),
            success: false,
            message: "Stack not found — run download step first".to_string(),
            detail: None,
        });
    }

    let result = run_cmd_in_dir(
        "docker",
        &["compose", "build", "--parallel"],
        &stack_dir,
    );

    match result {
        Ok(out) => Ok(SetupStepResult {
            step: "docker_build".to_string(),
            success: true,
            message: "Docker images built successfully".to_string(),
            detail: Some(out),
        }),
        Err(e) => Ok(SetupStepResult {
            step: "docker_build".to_string(),
            success: false,
            message: "Failed to build Docker images".to_string(),
            detail: Some(e),
        }),
    }
}

/// Start the Docker Compose stack
#[tauri::command]
pub async fn docker_compose_up() -> Result<SetupStepResult, String> {
    let stack_dir = get_stack_dir();

    if !stack_dir.join("docker-compose.yml").exists() {
        return Ok(SetupStepResult {
            step: "docker_up".to_string(),
            success: false,
            message: "Stack not found — run download step first".to_string(),
            detail: None,
        });
    }

    let result = run_cmd_in_dir(
        "docker",
        &["compose", "up", "-d"],
        &stack_dir,
    );

    match result {
        Ok(out) => Ok(SetupStepResult {
            step: "docker_up".to_string(),
            success: true,
            message: "Sovereign Stack services started".to_string(),
            detail: Some(out),
        }),
        Err(e) => Ok(SetupStepResult {
            step: "docker_up".to_string(),
            success: false,
            message: "Failed to start services".to_string(),
            detail: Some(e),
        }),
    }
}

/// Stop the Docker Compose stack
#[tauri::command]
pub async fn docker_compose_down() -> Result<SetupStepResult, String> {
    let stack_dir = get_stack_dir();

    let result = run_cmd_in_dir(
        "docker",
        &["compose", "down"],
        &stack_dir,
    );

    match result {
        Ok(_) => Ok(SetupStepResult {
            step: "docker_down".to_string(),
            success: true,
            message: "All services stopped".to_string(),
            detail: None,
        }),
        Err(e) => Ok(SetupStepResult {
            step: "docker_down".to_string(),
            success: false,
            message: "Failed to stop services".to_string(),
            detail: Some(e),
        }),
    }
}

/// Pull Ollama embedding model inside the running container
#[tauri::command]
pub async fn pull_ollama_model() -> Result<SetupStepResult, String> {
    let stack_dir = get_stack_dir();

    let result = run_cmd_in_dir(
        "docker",
        &["compose", "exec", "-T", "ollama", "ollama", "pull", "nomic-embed-text"],
        &stack_dir,
    );

    match result {
        Ok(_) => Ok(SetupStepResult {
            step: "pull_model".to_string(),
            success: true,
            message: "Embedding model ready".to_string(),
            detail: None,
        }),
        Err(e) => {
            // Non-fatal — model can be pulled later
            Ok(SetupStepResult {
                step: "pull_model".to_string(),
                success: false,
                message: "Model download deferred — will retry on first use".to_string(),
                detail: Some(e),
            })
        }
    }
}

/// Check which Docker services are healthy
#[tauri::command]
pub async fn check_stack_health() -> Result<Vec<ServiceHealth>, String> {
    let services = vec![
        ("LiteLLM", 4000u16, "http://127.0.0.1:4000/health/liveliness"),
        ("API", 3100, "http://127.0.0.1:3100/health"),
        ("Ollama", 11434, "http://127.0.0.1:11434/api/tags"),
        ("Web UI", 3000, "http://127.0.0.1:3000"),
        ("PostgreSQL", 5432, ""),
        ("Redis", 6379, ""),
    ];

    let mut results = Vec::new();

    for (name, port, url) in services {
        if url.is_empty() {
            // TCP port check for DB services
            let healthy = std::net::TcpStream::connect_timeout(
                &format!("127.0.0.1:{}", port).parse().unwrap(),
                std::time::Duration::from_secs(2),
            )
            .is_ok();

            results.push(ServiceHealth {
                name: name.to_string(),
                healthy,
                status: if healthy {
                    "running".to_string()
                } else {
                    "starting".to_string()
                },
                port,
            });
        } else {
            // HTTP health check
            let check = Command::new("curl")
                .args(["-sf", "--max-time", "3", url])
                .output();

            let healthy = check.map(|o| o.status.success()).unwrap_or(false);

            results.push(ServiceHealth {
                name: name.to_string(),
                healthy,
                status: if healthy {
                    "running".to_string()
                } else {
                    "starting".to_string()
                },
                port,
            });
        }
    }

    Ok(results)
}

/// Get Docker container resource usage (for progress display)
#[tauri::command]
pub async fn get_docker_ps() -> Result<String, String> {
    let stack_dir = get_stack_dir();
    run_cmd_in_dir(
        "docker",
        &["compose", "ps", "--format", "json"],
        &stack_dir,
    )
    .or_else(|_| {
        // Fallback: plain format
        run_cmd_in_dir("docker", &["compose", "ps"], &stack_dir)
    })
}
