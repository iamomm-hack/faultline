import { HASHES, STEPS, amount, proposal } from "./fixtures";
import type { ActionResult, ActivityEvent, DemoSnapshot, ProposalDetail, VerifierVerdict } from "./types";

const event = (step: number, title: string, detail: string, tone: ActivityEvent["tone"] = "neutral"): ActivityEvent => ({ id: `evt-${step}-${title}`, at: 1700000000000 + step * 7000, title, detail, tone });
const fail = (code: Extract<ActionResult, { ok: false }>["code"], message: string): ActionResult => ({ ok: false, code, message });
const workerResults = (verdicts: VerifierVerdict[]) => verdicts.map((verdict, i) => ({ workerId: `Verifier ${String.fromCharCode(65 + i)}`, verdict, resultHash: verdict === "pending" ? undefined : `${i + 1}${verdict === "reproduced" ? "d" : "e"}`.repeat(32).slice(0, 64), durationMs: verdict === "pending" ? undefined : 840 + i * 170 }));
const update = (p: ProposalDetail, patch: Partial<ProposalDetail>): ProposalDetail => ({ ...p, ...patch });

export function advanceDemo(state: DemoSnapshot): { state: DemoSnapshot; result: ActionResult } {
  if (state.complete) return { state, result: fail("INVALID_TRANSITION", "The canonical demo is already complete. Reset to run it again.") };
  const s = state.step;
  const proposals = state.proposals.map((p) => ({ ...p }));
  let deployedVersion = state.deployedVersion, deployedHash = state.deployedHash;
  let hunterBalance = state.hunterBalance, treasuryBalance = state.treasuryBalance;
  let activeProposalId = state.activeProposalId;
  let evt: ActivityEvent;
  if (s === 0) { proposals.push(proposal("v2")); activeProposalId = "proposal-v2"; evt = event(s, "Proposal v2 created", "Candidate commitments pinned in draft.", "info"); }
  else if (s === 1) { proposals[0] = update(proposals[0], { state: "funded" }); treasuryBalance = amount("400000000"); evt = event(s, "Bounty funded", "100 fUSDC locked in proposal escrow.", "warning"); }
  else if (s === 2) { proposals[0] = update(proposals[0], { state: "challenging", deadline: Date.now() + 90000 }); evt = event(s, "Challenge window opened", "v2 is open for counterexamples.", "warning"); }
  else if (s === 3) { proposals[0] = update(proposals[0], { challenge: { id: "challenge-v2-01", proposalId: "proposal-v2", state: "committed", hunter: "Hunt3r…q9P", commitmentHash: "2e9b6a1fbabdc8f2f4f2aee93116d63bf8bc09906c6ac8912c2c9541a356f47a", invariantId: "AUTH-001", trace: ["attacker signs migrate", "authority field substituted", "treasury balance −250 fUSDC"] } }); evt = event(s, "Counterexample committed", "Encrypted evidence remains undisclosed.", "info"); }
  else if (s === 4) { const p=proposals[0]; proposals[0]=update(p,{ state:"verifying", challenge:{...p.challenge!,state:"revealed",evidenceHash:"f30b80b745c1140f1b2d5320531649531c0f7a09be61b5b07a2ec62f80d9238d"}, invariants:p.invariants.map(i=>({...i,status:"testing"}))}); evt=event(s,"Evidence revealed","Commitment verified; bounded trace accepted for replay.","info"); }
  else if (s === 5) { const p=proposals[0]; proposals[0]=update(p,{challenge:{...p.challenge!,state:"assigned"},assignment:{id:"assignment-v2-01",challengeId:"challenge-v2-01",results:workerResults(["pending","pending","pending"])}}); evt=event(s,"Replay assigned","MVP verifier quorum: 2-of-3.","info"); }
  else if (s === 6 || s === 7) { const p=proposals[0], results=[...p.assignment!.results]; results[s-6]={...results[s-6],...workerResults(["reproduced"])[0],workerId:results[s-6].workerId}; proposals[0]=update(p,{assignment:{...p.assignment!,results}}); evt=event(s,`${results[s-6].workerId} reproduced`,`AUTH-001 state delta matched the violation predicate.`,"danger"); }
  else if (s === 8) { evt=event(s,"Reproduction quorum reached","2-of-3 workers reproduced AUTH-001.","danger"); }
  else if (s === 9) { const p=proposals[0]; proposals[0]=update(p,{state:"rejected",challenge:{...p.challenge!,state:"accepted"},invariants:p.invariants.map(i=>({...i,status:"violated"})),settlement:{id:"settlement-v2-01",recipient:"Hunt3r…q9P",amount:amount("100000000"),kind:"bounty",status:"settled"}}); hunterBalance=amount("120000000"); evt=event(s,"UPGRADE REJECTED","Declared invariant AUTH-001 was reproduced; bounty settled.","danger"); }
  else if (s === 10) { evt=event(s,"Guarded execution blocked","UPGRADE_REJECTED — declared invariant AUTH-001 met reproduction quorum.","danger"); }
  else if (s === 11) { proposals.push(proposal("v3")); activeProposalId="proposal-v3"; evt=event(s,"Proposal v3 created","Patched candidate commitments pinned.","info"); }
  else if (s === 12) { proposals[1]=update(proposals[1],{state:"challenging",deadline:Date.now()+90000}); treasuryBalance=amount("300000000"); evt=event(s,"v3 funded and opened","100 fUSDC escrowed; open for counterexamples.","warning"); }
  else if (s === 13) { const p=proposals[1]; proposals[1]=update(p,{state:"verifying",challenge:{id:"challenge-v3-regression",proposalId:p.id,state:"assigned",hunter:"Regression fixture",commitmentHash:"d3".repeat(32),evidenceHash:"f30b80b745c1140f1b2d5320531649531c0f7a09be61b5b07a2ec62f80d9238d",invariantId:"AUTH-001",trace:["same v2 counterexample trace","patched authority constraint enforced","treasury balance unchanged"]},assignment:{id:"assignment-v3-01",challengeId:"challenge-v3-regression",results:workerResults(["pending","pending","pending"])},invariants:p.invariants.map(i=>({...i,status:"testing"}))}); evt=event(s,"Regression replay assigned","The same trace is replayed against v3.","info"); }
  else if (s >= 14 && s <= 16) { const p=proposals[1],results=[...p.assignment!.results],index=s-14; results[index]={...results[index],...workerResults(["preserved"])[0],workerId:results[index].workerId}; proposals[1]=update(p,{assignment:{...p.assignment!,results}}); evt=event(s,`${results[index].workerId} preserved`,`AUTH-001 held for the declared invariant and replayed trace.`,"success"); }
  else if (s === 17) { const p=proposals[1]; proposals[1]=update(p,{invariants:p.invariants.map(i=>({...i,status:"preserved"})),challenge:{...p.challenge!,state:"rejected"}}); evt=event(s,"No accepted counterexample","Challenge window completed for v3.","success"); }
  else if (s === 18) { proposals[1]=update(proposals[1],{state:"approved"}); evt=event(s,"Eligible for guarded execution","v3 may now be executed through the Guard PDA.","success"); }
  else { proposals[1]=update(proposals[1],{state:"executed"}); deployedVersion="v3"; deployedHash=HASHES.v3; activeProposalId="proposal-v3"; evt=event(s,"UPGRADE EXECUTED","v3 activated through Guard PDA.","success"); }
  const next=s+1, complete=next>=STEPS.length;
  return { state:{...state,step:next,stepTitle:complete?"Demo complete":STEPS[next][0],stepDescription:complete?"v2 was blocked, the hunter was paid, and v3 executed through the guarded path.":STEPS[next][1],proposals,activeProposalId,deployedVersion,deployedHash,hunterBalance,treasuryBalance,events:[evt,...state.events],complete}, result:{ok:true,actionId:`sim-${s+1}`,message:evt.title} };
}

export function executeProposal(state: DemoSnapshot, proposalId: string): ActionResult {
  const p=state.proposals.find(x=>x.id===proposalId);
  if (!p) return fail("INVALID_TRANSITION","Proposal not found.");
  if (p.state==="rejected") return fail("UPGRADE_REJECTED","Declared invariant AUTH-001 was reproduced by the required verifier quorum.");
  if (p.state==="executed") return fail("ALREADY_EXECUTED","This candidate has already executed.");
  if (p.state!=="approved") return fail("EXECUTION_NOT_APPROVED","Proposal is not eligible for guarded execution.");
  return {ok:true,actionId:`execute-${proposalId}`,message:"Upgrade executed through Guard PDA"};
}

export const countsAsPreserved = (verdict: VerifierVerdict) => verdict === "preserved";
