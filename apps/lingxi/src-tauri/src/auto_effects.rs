//! User opt-in for agent-chosen surprises. Manual playback stays available.
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

pub const COOLDOWN: Duration = Duration::from_secs(10 * 60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub cooldown_ms: u64,
    pub remaining_cooldown_ms: u64,
}

#[derive(Default)]
pub struct AutoEffects {
    enabled: AtomicBool,
    last_started: Mutex<Option<Instant>>,
}

impl AutoEffects {
    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn status(&self, now: Instant) -> Status {
        let remaining = self
            .last_started
            .lock()
            .unwrap()
            .map(|at| COOLDOWN.saturating_sub(now.saturating_duration_since(at)))
            .unwrap_or_default();
        Status {
            enabled: self.enabled(),
            cooldown_ms: COOLDOWN.as_millis() as u64,
            remaining_cooldown_ms: remaining.as_millis() as u64,
        }
    }

    fn check(&self, last: Option<Instant>, now: Instant) -> Result<(), &'static str> {
        if !self.enabled() {
            return Err("automatic effects are disabled by the user; do not retry or enable them for the user");
        }
        if last.is_some_and(|at| now.saturating_duration_since(at) < COOLDOWN) {
            return Err(
                "automatic effects are cooling down; skip this surprise instead of retrying",
            );
        }
        Ok(())
    }

    /// Check before stage scheduling without spending the cooldown on a queued/dropped request.
    pub fn may_start(&self, now: Instant) -> Result<(), &'static str> {
        self.check(*self.last_started.lock().unwrap(), now)
    }

    /// Reserve atomically only when playback is about to be emitted. Shared across all agents.
    pub fn try_start(&self, automatic: bool, now: Instant) -> Result<(), &'static str> {
        if !automatic {
            return Ok(());
        }
        let mut last = self.last_started.lock().unwrap();
        self.check(*last, now)?;
        *last = Some(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opt_in_is_required_but_manual_playback_stays_available() {
        let policy = AutoEffects::default();
        let now = Instant::now();
        assert!(!policy.enabled());
        assert!(policy.try_start(true, now).is_err());
        assert!(policy.try_start(false, now).is_ok());
        policy.set_enabled(true);
        assert!(policy.try_start(true, now).is_ok());
        policy.set_enabled(false);
        assert!(policy.try_start(true, now + COOLDOWN).is_err());
    }

    #[test]
    fn probes_and_manual_playback_do_not_spend_or_reset_the_shared_cooldown() {
        let policy = AutoEffects::default();
        policy.set_enabled(true);
        let now = Instant::now();
        assert!(policy.may_start(now).is_ok());
        assert!(policy.may_start(now).is_ok());
        assert!(policy.try_start(true, now).is_ok());
        assert!(policy
            .try_start(false, now + Duration::from_secs(1))
            .is_ok());
        assert!(policy
            .try_start(true, now + Duration::from_secs(2))
            .is_err());
        assert_eq!(
            policy
                .status(now + Duration::from_secs(2))
                .remaining_cooldown_ms,
            598_000
        );
        assert!(policy.try_start(true, now + COOLDOWN).is_ok());
    }

    #[test]
    fn simultaneous_agents_cannot_both_start_a_surprise() {
        let policy = std::sync::Arc::new(AutoEffects::default());
        policy.set_enabled(true);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let now = Instant::now();
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let policy = policy.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    policy.try_start(true, now).is_ok()
                })
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .filter_map(|t| t.join().ok())
                .filter(|ok| *ok)
                .count(),
            1
        );
    }
}
