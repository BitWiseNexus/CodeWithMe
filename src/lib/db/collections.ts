import "server-only";
import type { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";

/*
 * Firestore layout. Only the modules in src/lib/db/ touch these collections;
 * pages, actions and routes call their functions instead.
 *
 *   problems/{slug}                      Problem (doc id = slug, so unique)
 *   problems/{slug}/test_cases/{id}      TestCase
 *   drafts/{uid}_{problemId}_{language}  Draft — saved code, one per triple
 *   executions/{autoId}                  one per "Run", completed by the worker
 *   submissions/{autoId}                 one per "Submit", judged by the worker
 *   users/{uid}/progress/{problemId}     attempted | solved (written by the worker)
 *
 * Clients never talk to Firestore directly (see firestore.rules); all access
 * goes through the Admin SDK on the server, scoped to the signed-in user.
 */
export const problemsCol = () => db.collection("problems");
export const testCasesCol = (problemId: string) =>
  problemsCol().doc(problemId).collection("test_cases");
export const draftsCol = () => db.collection("drafts");
export const executionsCol = () => db.collection("executions");
export const submissionsCol = () => db.collection("submissions");
export const progressCol = (userId: string) =>
  db.collection("users").doc(userId).collection("progress");

export const toIso = (t: Timestamp | null | undefined) => t?.toDate().toISOString() ?? "";
