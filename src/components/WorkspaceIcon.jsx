const ICON_PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  markets: <><path d="M4 19V9" /><path d="M8 15V5" /><path d="M12 20V11" /><path d="M16 13V4" /><path d="M20 18V8" /><path d="M2 19h20" /></>,
  scanner: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  watchlist: <path d="m12 3 2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6L3.27 9.35l6.03-.88L12 3Z" />,
  portfolio: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M9 12v2h6v-2" /></>,
  risk: <><path d="M12 3 4.5 6v5.5c0 4.4 3 7.7 7.5 9.5 4.5-1.8 7.5-5.1 7.5-9.5V6L12 3Z" /><path d="M12 8v5M12 16h.01" /></>,
  orders: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  strategies: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="8" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 5h2a4 4 0 0 1 4 4v5a4 4 0 0 0 4 4M14 10a4 4 0 0 1 4-2" /></>,
  backtesting: <><path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68" /><path d="M4 4v4.68h4.68M12 7v5l3 2" /></>,
  research: <><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16H7a2 2 0 0 0-2 2V4Z" /><path d="M5 20a2 2 0 0 1 2-2h12M9 7h6M9 11h4" /></>,
  copilot: <><path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z" /><path d="m18.5 14 .75 2.25 2.25.75-2.25.75L18.5 20l-.75-2.25L15.5 17l2.25-.75.75-2.25ZM5 13l.55 1.45L7 15l-1.45.55L5 17l-.55-1.45L3 15l1.45-.55L5 13Z" /></>,
  reports: <><path d="M6 2h9l4 4v16H6V2Z" /><path d="M15 2v5h4M9 17v-4M12 17V9M15 17v-6" /></>,
  health: <><path d="M3 12h4l2-5 4 10 2-5h6" /><path d="M5 5.5A9 9 0 1 1 3 12" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.35.26.57.65.6 1.09V10h1v4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></>,
}

export function WorkspaceIcon({ name }) {
  return (
    <svg className="workspace-icon" data-workspace-icon={name} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
      {ICON_PATHS[name] ?? ICON_PATHS.dashboard}
    </svg>
  )
}

export default WorkspaceIcon
