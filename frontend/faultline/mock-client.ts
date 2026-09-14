import type { FaultlineClient } from "./client";
import { advanceDemo as transition, executeProposal } from "./state-machine";
import { initialSnapshot } from "./fixtures";
import type { ActionErrorCode, ActionResult, CommitChallengeInput, CreateProposalInput, DemoSnapshot, TokenAmount } from "./types";

const STORAGE_KEY="faultline.prototype.v1";
export class MockFaultlineClient implements FaultlineClient {
  private state:DemoSnapshot; private listeners=new Set<()=>void>(); private delayMs:number; private nextError:ActionErrorCode|null=null;
  constructor(options?:{initialState?:DemoSnapshot;delayMs?:number}) { this.delayMs=options?.delayMs??380; this.state=options?.initialState??this.read()??initialSnapshot(); }
  private read(){ if(typeof window==="undefined") return null; try { const raw=localStorage.getItem(STORAGE_KEY); return raw?JSON.parse(raw) as DemoSnapshot:null; } catch{return null;} }
  private persist(){ if(typeof window!=="undefined") localStorage.setItem(STORAGE_KEY,JSON.stringify(this.state)); this.listeners.forEach(l=>l()); }
  private async wait(){ if(this.delayMs>0) await new Promise<void>(r=>setTimeout(r,this.delayMs)); }
  getSnapshot=()=>this.state; subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener)};
  async listProposals(){await this.wait();return this.state.proposals.map(({id,candidateVersion,state,bounty,deadline})=>({id,candidateVersion,state,bounty,deadline}));}
  async getProposal(id:string){await this.wait();const p=this.state.proposals.find(x=>x.id===id);if(!p)throw new Error("Proposal not found");return p;}
  setNextError=(code:ActionErrorCode|null)=>{this.nextError=code};
  async advanceDemo():Promise<ActionResult>{await this.wait();if(this.nextError){const code=this.nextError;this.nextError=null;return {ok:false,code,message:errorMessages[code]};}const next=transition(this.state);this.state=next.state;this.persist();return next.result;}
  async resetDemo(){await this.wait();this.state=initialSnapshot();this.persist();}
  async executeUpgrade(id:string){await this.wait();return executeProposal(this.state,id);}
  async createProposal(_input:CreateProposalInput){return this.advanceDemo();} async fundProposal(_id:string,_amount:TokenAmount){return this.advanceDemo();}
  async openChallengeWindow(_id:string){return this.advanceDemo();} async commitChallenge(_input:CommitChallengeInput){return this.advanceDemo();}
  async revealChallenge(_id:string){return this.advanceDemo();} async runVerifierReplay(_id:string){return this.advanceDemo();} async resolveProposal(_id:string){return this.advanceDemo();}
}
const errorMessages:Record<ActionErrorCode,string>={INSUFFICIENT_BOUNTY:"Escrow is below the policy minimum.",CHALLENGE_WINDOW_CLOSED:"The stored challenge deadline has elapsed.",EVIDENCE_COMMITMENT_MISMATCH:"Revealed evidence does not match the commitment.",VERIFIER_TIMEOUT:"The assigned replay worker missed its deadline.",UPGRADE_REJECTED:"Declared invariant AUTH-001 was reproduced by the required verifier quorum.",EXECUTION_NOT_APPROVED:"Proposal is not eligible for guarded execution.",CANDIDATE_ARTIFACT_MISMATCH:"Candidate buffer digest differs from the pinned artifact.",INVALID_TRANSITION:"This action is not valid in the current state.",ALREADY_EXECUTED:"This candidate has already executed."};
