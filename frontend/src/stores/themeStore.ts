import { create } from "zustand"

type Theme = "light" | "dark" | "system"

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme
  document.documentElement.classList.toggle("dark", resolved === "dark")
}

const saved = (localStorage.getItem("theme") as Theme) || "system"

export const useThemeStore = create<ThemeState>((set) => ({
  theme: saved,
  setTheme: (theme) => {
    localStorage.setItem("theme", theme)
    applyTheme(theme)
    set({ theme })
  },
}))

applyTheme(saved)
