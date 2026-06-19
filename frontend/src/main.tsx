import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";   // 디자인 토큰 먼저(Wanted DS) → index.css 가 var() 로 승계
import "./index.css";
import "./styles/components.css"; // 컴포넌트 정제(섀도·포커스·버튼) — index.css 위에 얹음

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
