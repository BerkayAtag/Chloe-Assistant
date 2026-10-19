import type { OfficeTask } from './office-types';

/** No worker starts until every identity and dependency is validated. */
export function parseOfficePlan(text: string, workerIds: string[]): OfficeTask[] {
  const plan = JSON.parse(text);
  if (!Array.isArray(plan?.tasks) || !plan.tasks.length || plan.tasks.length > 4) throw new Error('Plan 1–4 görev içermeli.');
  const seen = new Set<string>();
  return plan.tasks.map((task: Record<string, unknown>) => {
    if (!task || typeof task.id !== 'string' || !task.id.trim() || seen.has(task.id)) throw new Error('Görev kimlikleri boş olmayan benzersiz metinler olmalı.');
    if (typeof task.agentId !== 'string' || !workerIds.includes(task.agentId)) throw new Error('agentId yalnız verilen çalışan kimliklerinden biri olmalı; ad veya rol değil.');
    if (typeof task.title !== 'string' || !task.title.trim() || typeof task.instructions !== 'string' || !task.instructions.trim()) throw new Error('Her görev başlık ve talimat içermeli.');
    if (!Array.isArray(task.dependsOn) || task.dependsOn.some(id => typeof id !== 'string' || !seen.has(id))) throw new Error('dependsOn yalnız bu dizide daha önce gelen görevlerin id alanlarına bağlanmalı.');
    seen.add(task.id);
    return { id: task.id, agentId: task.agentId, title: task.title, instructions: task.instructions, dependsOn: task.dependsOn as string[], status: 'queued', output: '' };
  });
}
