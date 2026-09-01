import { NavLink, Route, Routes } from "react-router-dom";
import TournamentPage from "./pages/Tournament";
import PhotoBooth from "./pages/PhotoBooth";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <nav className="nav">
        <NavLink to="/" end>
          Torneo
        </NavLink>
        <NavLink to="/fotobooth">Fotobooth</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<TournamentPage />} />
        <Route path="/fotobooth" element={<PhotoBooth />} />
      </Routes>
    </div>
  );
}
