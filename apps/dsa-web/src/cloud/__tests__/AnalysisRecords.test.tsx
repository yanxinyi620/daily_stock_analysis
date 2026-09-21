import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { AnalysisRecords } from '../AnalysisRecords';
import type { AnalysisRecord, CloudData } from '../client';

const row = (values: Partial<AnalysisRecord> = {}): AnalysisRecord => ({ id: 'report-1', status: 'succeeded', updated_at: '2026-09-20T00:00:00Z', codes: ['COMPOSITE'], report: { task_id: 'report-1', title: 'COMPOSITE', generated_at: '2026-09-20T00:00:00Z', market_as_of: null }, execution: null, ...values });
function setup(rows: AnalysisRecord[]) {
  const api = { records: vi.fn().mockResolvedValue({ rows, count: rows.length, active: false }), report: vi.fn(), download: vi.fn() };
  render(<MemoryRouter><AnalysisRecords api={api as unknown as CloudData} user="owner" revision={0} pageSize={1} formatDate={(value) => value} /></MemoryRouter>);
  return api;
}
test('partial completion stays distinct from successfully saved; missing reports remain visible', async () => {
  setup([row({ execution: { id: 'execution', report_id: 'report-1', runner_id: 'github-actions-daily', task_type: 'composite_analysis', status: 'succeeded', result_summary: { outcome: 'partial' } } }), row({ id: 'failed', status: 'publish_failed', report: null, codes: ['000001'] })]);
  const table = await screen.findByRole('table', { name: '分析记录' });
  expect(within(table).getByText('部分完成')).toBeInTheDocument();
  expect(within(table).getByText('每日定时')).toBeInTheDocument();
  expect(within(table).getByText('已保存')).toBeInTheDocument();
  expect(within(table).getByText('保存失败')).toBeInTheDocument();
  expect(within(table).getByText('暂无报告')).toBeInTheDocument();
  expect(within(table).queryByText('全部完成')).not.toBeInTheDocument();
  expect(within(table).getAllByRole('row')).toHaveLength(3);
});
test('download uses the owner-scoped detail and authenticated storage APIs', async () => {
  const api = setup([row()]);
  const report = { task_id: 'report-1', bucket: 'analysis-reports', object_path: 'owner/report.md' };
  api.report.mockResolvedValue(report); api.download.mockResolvedValue(new Blob(['report']));
  const create = vi.fn().mockReturnValue('blob:test'); const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(await screen.findByRole('button', { name: '下载 综合分析' }));
  await waitFor(() => expect(api.download).toHaveBeenCalledWith(report));
  expect(api.report).toHaveBeenCalledWith('owner', 'report-1');
  expect(create).toHaveBeenCalled(); expect(click).toHaveBeenCalled();
  click.mockRestore();
});
test('paging fetches the requested page and errors can be retried', async () => {
  const api = setup([row(), row({ id: 'report-2' })]);
  await screen.findByRole('table');
  api.records.mockRejectedValueOnce(new Error('private backend details'));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByRole('alert');
  expect(api.records).toHaveBeenCalledWith('owner', 1, 1);
  expect(screen.queryByText('private backend details')).not.toBeInTheDocument();
  api.records.mockResolvedValue({ rows: [row({ id: 'report-2' })], count: 2, active: false });
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
