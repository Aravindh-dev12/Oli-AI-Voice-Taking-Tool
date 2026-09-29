use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

pub struct VaultIndexer;

impl VaultIndexer {
    /// Scans vault directory and computes SHA-256 hashes for incremental sync
    pub fn sync_vault<P: AsRef<Path>>(
        vault_dir: P,
    ) -> Result<Vec<(PathBuf, String)>, Box<dyn std::error::Error>> {
        let mut indexed_files = Vec::new();
        let mut md_paths = Vec::new();

        Self::collect_markdown_files(vault_dir.as_ref(), &mut md_paths)?;

        for path in md_paths {
            let content = fs::read_to_string(&path)?;
            let current_hash = format!("{:x}", Sha256::digest(content.as_bytes()));

            indexed_files.push((path, current_hash));
        }

        Ok(indexed_files)
    }

    /// Chunks markdown content by headers (# and ##)
    pub fn chunk_markdown(content: &str) -> Vec<(String, String)> {
        let mut chunks = Vec::new();
        let mut current_heading = "General".to_string();
        let mut current_body = Vec::new();

        for line in content.lines() {
            if line.starts_with("# ") || line.starts_with("## ") {
                if !current_body.is_empty() {
                    chunks.push((current_heading.clone(), current_body.join("\n")));
                    current_body.clear();
                }
                current_heading = line.trim_start_matches('#').trim().to_string();
            } else if !line.trim().is_empty() {
                current_body.push(line);
            }
        }

        if !current_body.is_empty() {
            chunks.push((current_heading, current_body.join("\n")));
        }

        chunks
    }

    fn collect_markdown_files(
        dir: &Path,
        paths: &mut Vec<PathBuf>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    Self::collect_markdown_files(&path, paths)?;
                } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
                    paths.push(path);
                }
            }
        }
        Ok(())
    }
}
