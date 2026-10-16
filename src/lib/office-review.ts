import { contentHash } from './codex-workspace.ts';
import type { OfficeArtifact } from './office-types.ts';

export function reviewArtifacts(text: string, artifacts: OfficeArtifact[]) {
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''));
  if (!Array.isArray(value.reviews) || value.reviews.length !== artifacts.length) throw new Error('Denetçi her dosya için geçerli bir karar üretmedi; dosyalar uygulanamaz.');
  const seen = new Set<string>();
  const reviews = artifacts.map((artifact) => {
    const review = value.reviews.find((r: { path?: string }) => r?.path === artifact.path);
    if (!review || seen.has(review.path) || !['approved', 'changes_requested'].includes(review.verdict) || typeof review.summary !== 'string' || !review.summary.trim() || review.summary.length > 4000) throw new Error('Dosya denetim kararı geçersiz; dosyalar uygulanamaz.');
    seen.add(review.path);
    return { verdict: review.verdict as 'approved' | 'changes_requested', summary: review.summary, reviewedHash: contentHash(artifact.content), at: new Date().toISOString(), testsExecuted: false as const };
  });
  artifacts.forEach((artifact, i) => { artifact.review = reviews[i]; });
}
export function assertArtifactReviewed(artifact: OfficeArtifact) {
  if (!artifact.review || artifact.review.verdict !== 'approved' || artifact.review.reviewedHash !== contentHash(artifact.content)) throw new Error('Bu dosya için güncel, olumlu denetim kararı yok. Düzeltme göreviyle yeni bir çalışma başlat.');
}
