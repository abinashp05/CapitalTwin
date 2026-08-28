# CapitalTwin — The Loan That Travels With Your Goods

**CapitalTwin** is an agentic, real-time supply chain financing platform that replaces static, delayed paper credit with dynamic digital twins. As physical goods progress from purchase order to delivery, an autonomous multi-agent system continuously recomputes risk, adjusts Loan-to-Value (LTV) safe headroom, conducts automated lender reverse auctions, and secures transactions with an immutable SHA-256 cryptographic ledger.

---

## 🌟 Key Features & Core Innovations

### 1. 🔄 Real-Time Digital Twin Lifecycle
An autonomous digital twin (`ORD-123`) travels with goods through 9 distinct milestones:
- **PO Issued** (50% Base LTV) — Purchase order verified & title assigned.
- **Raw Procured** (55% Base LTV) — Yarn & materials received at factory.
- **In Production / Finished Goods** (60%–65% Base LTV) — Manufacturing & QA inspection completed.
- **In Transit** (75% Base LTV) — GPS fleet tracking & container telemetry active.
- **Warehoused** (80% Base LTV) — Ingress check-in at regional fulfillment centers.
- **Delivered** (85% Base LTV) — Digital Proof of Delivery (PoD) logged.
- **Invoiced** (90% Base LTV) — Net-60 commercial invoice registered.
- **Settled** (0% LTV) — Escrow payment automatically repays outstanding loan balances.

### 2. 📊 Dynamic Safe-Limit & Risk Engine
Credit is never static. Safe financing capacity is continuously recalculated using physical and contractual risk metrics:
$$\text{Risk Index} = 0.4 \times \text{Buyer Risk} + 0.25 \times \text{Delay Factor} + 0.2 \times \text{Condition Factor} + 0.015$$
$$\text{Effective LTV} = \text{Base LTV} \times (1.0 - 0.4 \times \text{Risk Index})$$
$$\text{Safe Capacity} = \lfloor \text{Order Value} \times \text{Effective LTV} \rfloor$$

If transit delays or temperature spikes occur, headroom automatically scales down and prevents over-leveraging.

### 3. ⚔️ Bank Battle — Live Reverse Auction
When a supplier requests a drawdown, CapitalTwin launches an automated, multi-round reverse auction among institutional lenders:
- **Cautious Bank** (Conservative floor: 11.0%)
- **Aggressive NBFC** (Competitive floor: 8.5%)
- **Balanced Fintech** (Balanced floor: 9.5%)

Lenders compete downward in real-time over WebSockets until the lowest interest rate is secured for the borrower.

### 4. ⛓️ Immutable Cryptographic Exposure Ledger
- Every financing disbursement and escrow settlement is cryptographically chained using **SHA-256 hashes**.
- Any attempt to pledge the same physical batch to multiple lenders (**Double-Financing Fraud**) is detected and blocked before funds can be released.
- Complete hash verification (`verifyLedger()`) validates block integrity on demand.

### 5. 🤖 Multi-Agent Telemetry & Gemini 3.7 Assistant
- **Tracker Agent**: Broadcasts physical telemetry, location updates, and delivery events.
- **Risk Agent**: Evaluates buyer delinquency, transit delays, and sensor anomalies.
- **Loan Agent**: Computes dynamic headroom, handles disbursements, and triggers settlements.
- **Fraud Agent**: Enforces title registry checks and protects the credit ledger.
- **AI Assistant**: Powered by **Google Gemini 3.7 Flash** to answer natural language questions about asset status, risk factors, and repayment forecasts, accompanied by optional Web Audio / TTS voice playback.

---

## 👥 Role-Based Portals

| Role | Username | Password | Purpose |
| :--- | :--- | :--- | :--- |
| **Supplier** | `ravi123` | `RaviSecure!2026` | Drawdown requests, available safe limits, lifecycle timeline, AI chat, dynamic chart. |
| **Lender** | `lender01` | `LenderAlpha#2026` | Portfolio analytics, asset registry, live Bank Battle auction, cryptographic ledger. |
| **Admin** | `admin2026` | `AdminMaster$2026` | Control Room simulation triggers, sensor anomalies, fraud attempts, demo reset. |

---

## 🛠️ Architecture & Tech Stack

```
   ┌─────────────────────────────────────────────────────────────┐
   │                  Modern Browser / Web Client                │
   │      (Vanilla ES Modules, Tailwind CSS v4, Chart.js)        │
   └───────────────▲───────────────────────────────▲─────────────┘
                   │ HTTP REST (JSON)              │ WebSockets (/ws/live)
   ┌───────────────▼───────────────────────────────▼─────────────┐
   │                     Express & Node.js                       │
   │  ┌────────────────────┬──────────────────────────────────┐  │
   │  │ State & Risk Engine│ Reverse Auction Engine (Bots)    │  │
   │  ├────────────────────┼──────────────────────────────────┤  │
   │  │ SHA-256 Ledger Bus │ Google Gemini 3.7 Flash SDK      │  │
   │  └────────────────────┴──────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────┘
```

- **Runtime**: Node.js with TypeScript (`tsx` in dev, `esbuild` for production bundle)
- **Web Framework**: Express 4 with RESTful endpoints
- **Real-Time Transport**: Native WebSockets (`ws`)
- **AI & Intelligence**: `@google/genai` (Gemini 3.7 Flash)
- **Styling**: Tailwind CSS v4 (Dark high-contrast theme)
- **Visuals & Charts**: Chart.js 4 (Real-time dynamic curve rendering)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ or 20+
- npm or bun

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```
Add your optional Gemini API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```
*(Note: If no API key is provided, the platform automatically utilizes a resilient fallback response engine).*

### 3. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Production Build
```bash
npm run build
npm start
```

---

## 📡 API Reference

### Authentication & Core State
- `POST /login` — Authenticate user and return role permissions (`supplier`, `lender`, `admin`).
- `GET /asset/:id` — Retrieve digital twin status, financial metrics, and current risk index.
- `GET /ledger/:id` — Retrieve full SHA-256 block chain and cryptographic verification status.

### Lifecycle & Simulation Events
- `POST /event` — Trigger lifecycle events:
  - `ORDER_CONFIRMED`, `RAW_PROCURED`, `PRODUCED`, `SHIPPED`, `WAREHOUSED`, `DELIVERED`, `INVOICED`, `BUYER_PAID`
  - Disruptions: `DELAYED` (+3 days), `TEMP_SPIKE` (degraded condition), `RECEIVABLE_DELAYED` (+0.35 buyer risk)
  - Fraud test: `DOUBLE_FINANCE_ATTEMPT`

### Financing Operations
- `POST /financing/request` — Validate safe limit and trigger reverse auction bidding (`amount` optional).
- `POST /financing/accept` — Accept winning lender offer, disburse funds, and commit block to ledger.
- `POST /reset` — Reset digital twin, ledger, and simulation counters to clean initial state.

### AI Assistant
- `POST /ask` — Query the digital twin with contextual Gemini prompt execution.

---

## 🧪 Interactive Demo Walkthrough

1. **Sign In as Supplier (`ravi`)**:
   - Observe initial state: **ORD-123** has no active loan yet.
2. **Switch to Control Room (`admin`)**:
   - Click **"Confirm Order (PO_ISSUED)"**.
   - Note the real-time AI Agent feed updates: *PO Issued (₹24.3L capacity established)*.
3. **Request Financing**:
   - Switch to **Supplier Portal** or **Lender Console**.
   - Click **"Request financing"** (e.g. 50% or Max).
   - Watch the **Bank Battle** reverse auction run live as lenders bid rates down from 14% to 8.5%.
   - Click **"Accept Best Offer"** to disburse funds.
4. **Advance Lifecycle**:
   - Advance stage to **Shipped (IN_TRANSIT)** and **Invoiced (INVOICED)**.
   - Watch safe headroom expand up to 90% LTV as risk decreases.
5. **Simulate Disruptions & Fraud Defense**:
   - Trigger **"Transit Delay (+3 Days)"** or **"Temperature Alert"** in Control Room to watch safe limit drop.
   - Trigger **"Attempt Double Financing"** to see CapitalTwin's cryptographic ledger immediately block the unauthorized claim.
6. **Automated Settlement**:
   - Trigger **"Buyer Pays in Full"** — observe escrow settlement auto-repaying all outstanding principal.

---

## 📄 License
MIT License. Built with Google AI Studio.
