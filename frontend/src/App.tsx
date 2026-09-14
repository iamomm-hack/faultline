import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { FaultlineProvider } from "@/faultline/provider";
import Home from "@/app/page";
import DemoPage from "@/app/demo/page";
import NewProposal from "@/app/proposals/new/page";
import ProposalPage from "@/app/proposals/[proposalId]/page";
import ResearcherPage from "@/app/researcher/[proposalId]/page";

export function App() {
  return (
    <FaultlineProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/proposals/new" element={<NewProposal />} />
          <Route path="/proposals/:proposalId" element={<ProposalPage />} />
          <Route path="/researcher/:proposalId" element={<ResearcherPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </FaultlineProvider>
  );
}
