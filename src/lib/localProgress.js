const PREFIX = 'ecg-lab:v1:'

export function readProgress(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + key)) ?? fallback
  } catch {
    return fallback
  }
}

export function writeProgress(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
