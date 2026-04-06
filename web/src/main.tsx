import { createRoot } from "react-dom/client"
import App from "./App"
import "./index.css"

// StrictMode off for now: in dev it double-invokes effects, which doubles Spotify API calls
// (OAuth + playlists) and hits rate limits quickly. Re-enable when comfortable:
//   import { StrictMode } from "react"
//   <StrictMode><App /></StrictMode>
createRoot(document.getElementById("root")!).render(<App />)
