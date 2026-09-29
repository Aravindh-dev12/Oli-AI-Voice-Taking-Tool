use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThermalLevel {
    Nominal,
    Fair,
    Serious,
    Critical,
}

#[derive(Debug, Clone, Copy)]
pub struct EngineThrottleConfig {
    pub whisper_window_secs: f32,
    pub max_slm_tokens: usize,
    pub poll_frequency: Duration,
    pub skip_semantic_eval: bool,
}

pub struct HardwareThrottler;

impl HardwareThrottler {
    /// Determines thermal state and power source to select engine profile
    pub fn get_active_config() -> EngineThrottleConfig {
        let thermal = Self::query_os_thermal_state();
        let on_battery = Self::is_running_on_battery();

        match (thermal, on_battery) {
            // Hot or Low Battery -> Low Power Conservative Mode
            (ThermalLevel::Critical, _) | (ThermalLevel::Serious, _) => EngineThrottleConfig {
                whisper_window_secs: 5.0,
                max_slm_tokens: 15,
                poll_frequency: Duration::from_secs(5),
                skip_semantic_eval: true,
            },
            // Moderate Battery Use -> Balanced Profile
            (_, true) | (ThermalLevel::Fair, _) => EngineThrottleConfig {
                whisper_window_secs: 3.5,
                max_slm_tokens: 25,
                poll_frequency: Duration::from_secs(10),
                skip_semantic_eval: false,
            },
            // Plugged in & Cool -> Full Speed Real-Time Profile
            (ThermalLevel::Nominal, false) => EngineThrottleConfig {
                whisper_window_secs: 2.0,
                max_slm_tokens: 35,
                poll_frequency: Duration::from_secs(15),
                skip_semantic_eval: false,
            },
        }
    }

    #[cfg(target_os = "macos")]
    fn query_os_thermal_state() -> ThermalLevel {
        // In production, use NSProcessInfo.processInfo.thermalState
        // For now, return nominal
        ThermalLevel::Nominal
    }

    #[cfg(target_os = "windows")]
    fn query_os_thermal_state() -> ThermalLevel {
        // In production, check Windows thermal throttling flags
        ThermalLevel::Nominal
    }

    #[cfg(target_os = "macos")]
    fn is_running_on_battery() -> bool {
        // In production, use pmset -g batt
        false
    }

    #[cfg(target_os = "windows")]
    fn is_running_on_battery() -> bool {
        // In production, use GetSystemPowerStatus
        false
    }
}
