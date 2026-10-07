# 👁 Big Boss Command Center

> A real-time, reality-show style **control room** for the Tech House — manage contestants, tasks, scores, nominations, immunity, captaincy, announcements, timers and evictions from a single dashboard.

![Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-e34f26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572b6?style=flat-square&logo=css3&logoColor=white)
![No Dependencies](https://img.shields.io/badge/dependencies-none-22e39b?style=flat-square)

---

## ✨ Features

| # | Feature | Highlights |
|---|---------|------------|
| 1 | **Contestant Management** | 8 seeded contestants (name, team, points, status), add new ones, per-row quick actions |
| 2 | **Live Leaderboard** | Auto-ranked by points, 🥇🥈🥉 medals, Captain highlighted, evicted removed, flash on change |
| 3 | **Task Management** | Assign to a contestant or team, active/completed lists, completing awards points |
| 4 | **Point System** | Add / deduct with custom amount and quick buttons; instant updates everywhere |
| 5 | **Captaincy** | Assign / change / remove; only one Captain at a time, gold highlight |
| 6 | **Nominations** | Nominate / cancel; immune contestants are blocked |
| 7 | **Immunity** | Grant / revoke; green badge; protects from nomination |
| 8 | **Danger Zone** | Pulsing red panel listing every nominee with team, points and immunity info |
| 9 | **Big Boss Announcement** | Full-screen broadcast overlay, header "ON AIR" indicator, ticker and feed |
| 10 | **Task Timer** | Start / pause / reset, configurable minutes, progress bar, running/paused/finished states |
| 11 | **House Statistics** | Active count, top scorer & score, tasks done/active, nominees, immune, Captain & more |
| 12 | **Eviction** | Confirmation, removed from active house & leaderboard, blocked from points/tasks/nominations, kept in Eviction History |

### Real-time flow
`Action → State update → Re-render of every panel`. A single state store feeds the leaderboard, tables, selects, Danger Zone, stats, timer and feeds, so everything stays in sync.

### Extras
- 📜 Activity log and scrolling live ticker
- 🔔 Toast notifications and validation messages
- 💾 State saved in `localStorage` (survives refresh)
- ⟲ One-click reset to demo data
- 📱 Responsive layout

---

## 🚀 Getting Started

No build step or dependencies required.

```bash
git clone https://github.com/srinjays/tech_boss_event.git
cd tech_boss_event

# Option 1: just open index.html in your browser
# Option 2: serve locally
python -m http.server 5500
# → http://localhost:5500
```

## 🧪 Quick Demo Script

1. **Points** – pick Tara, add 600 → she jumps to #1 and Highest Scorer updates.
2. **Captain** – assign Riya, then Kabir → Riya loses the crown.
3. **Immunity** – grant Meera immunity → she becomes un-nominatable.
4. **Nominate** – nominate Arjun → Danger Zone and Nominees stat update.
5. **Task** – click ✓ Done on a task → Completed Tasks increments.
6. **Timer** – Start, Pause, Reset.
7. **Announce** – broadcast a message → overlay appears.
8. **Evict** – evict Arjun → gone from leaderboard, listed in Eviction History.

## 🗂 Project Structure

```
├── index.html   # Dashboard layout
├── styles.css   # Dark control-room design system
├── app.js       # State store, actions, timer, rendering
└── README.md
```

## 🏗 Architecture

- **State**: one `state` object (contestants, tasks, announcements, activity, evictions, timer).
- **Actions**: functions that validate rules (immune can't be nominated, evicted can't receive anything, single Captain) then call `commit()`.
- **Render**: `commit()` saves to storage and re-renders all components.

---

Made for the **Big Boss Tech House** challenge. 🎬
