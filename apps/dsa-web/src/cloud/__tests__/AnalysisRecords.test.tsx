import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { AnalysisRecords } from '../AnalysisRecords';
import type { AnalysisRecord, CloudData } from '../client';

const row = (values: Partial<AnalysisRecord> = {}): AnalysisRecord => ({ id: 'report-1', status: 'succeeded', updated_at: '2026-09-20T00:00:00Z', codes: ['COMPOSITE'], report: { task_id: 'report-1', title: 'COMPOSITE', generated_at: '2026-09-20T00:00:00Z', market_as_of: null }, execution: null, ...values });
function setup(rows: AnalysisRecord[]) {
  const api = { records: vi.fn().mockResolvedValue({ rows, count: rows.length, active: false }), report: vi.fn(), download: vi.fn(), setRecordDeleted: vi.fn().mockResolvedValue(undefined), permanentlyDeleteReport: vi.fn().mockResolvedValue(undefined) };
  render(<MemoryRouter><AnalysisRecords api={api as unknown as CloudData} user="owner" revision={0} pageSize={1} formatDate={(value) => value} /></MemoryRouter>);
  return api;
}
test('partial completion stays distinct from successfully saved; missing reports remain visible', async () => {
  setup([row({ execution: { id: 'execution', report_id: 'report-1', runner_id: 'github-actions-daily', task_type: 'composite_analysis', status: 'succeeded', result_summary: { outcome: 'partial' } } }), row({ id: 'failed', status: 'publish_failed', report: null, codes: ['000001'] })]);
  const table = await screen.findByRole('table', { name: '分析记录' });
  expect(within(table).getByText('部分完成')).toBeInTheDocument();
  expect(within(table).getByText('每日定时')).toBeInTheDocument();
  expect(within(table).queryByText('已保存')).not.toBeInTheDocument();
  expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
  expect(within(table).queryByText('报告生成')).not.toBeInTheDocument();
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
  expect(api.records).toHaveBeenCalledWith('owner', 1, 1, false);
  expect(screen.queryByText('private backend details')).not.toBeInTheDocument();
  api.records.mockResolvedValue({ rows: [row({ id: 'report-2' })], count: 2, active: false });
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('single-stock titles show the name without type or code prefixes', async () => {
  setup([row({ codes: ['000001'], report: { task_id: 'report-1', title: '000001', stock_name: '平安银行', stock_code: '000001', generated_at: 'now', market_as_of: null } })]);
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('link', { name: '平安银行' })).toBeInTheDocument();
  expect(within(table).queryByText(/个股分析/)).not.toBeInTheDocument();
});
test('deletion confirms, handles failure, and retries without falsely removing a record', async () => {
  const api = setup([row()]);
  fireEvent.click(await screen.findByRole('button', { name: '删除 综合分析' }));
  expect(api.setRecordDeleted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '删除 综合分析' }));
  api.setRecordDeleted.mockRejectedValueOnce(new Error('secret backend detail'));
  fireEvent.click(screen.getByRole('button', { name: '移入回收站' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/操作失败/);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.queryByText('secret backend detail')).not.toBeInTheDocument();
  api.records.mockResolvedValue({ rows: [], count: 0, active: false });
  fireEvent.click(screen.getByRole('button', { name: '移入回收站' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.setRecordDeleted).toHaveBeenCalledWith('report-1', true);
  await screen.findByText('暂无分析记录。分析结果开始保存后会出现在这里。');
});
test('recycle bin restores records and active publication cannot be deleted', async () => {
  const api = setup([row({ status: 'publishing' })]);
  expect(await screen.findByRole('button', { name: '删除 综合分析' })).toBeDisabled();
  api.records.mockResolvedValue({ rows: [row({ deleted_at: '2026-09-21T00:00:00Z' })], count: 1, active: false });
  fireEvent.click(screen.getByRole('button', { name: '回收站' }));
  fireEvent.click(await screen.findByRole('button', { name: '恢复 综合分析' }));
  await waitFor(() => expect(api.setRecordDeleted).toHaveBeenCalledWith('report-1', false));
  expect(api.records).toHaveBeenCalledWith('owner', 0, 1, true);
});

test.each([
  ['completed', '已完成'], ['partial', '部分完成'], [undefined, '已保存'],
])('composite outcome %s renders a single truthful status', async (outcome, label) => {
  setup([row({ execution: { id: 'execution', report_id: 'report-1', runner_id: 'local-primary', task_type: 'composite_analysis', status: 'succeeded', result_summary: { outcome } } })]);
  const table = await screen.findByRole('table');
  expect(within(table).getByText(label, { exact: true })).toBeInTheDocument();
  expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
});
test('missing stock names fall back to the code without analysis prefix', async () => {
  setup([row({ codes: ['000001'], report: { task_id: 'report-1', title: '个股分析 · 000001', generated_at: 'now', market_as_of: null } })]);
  expect(await screen.findByRole('link', { name: '000001' })).toBeInTheDocument();
  expect(screen.queryByText('个股分析 · 000001')).not.toBeInTheDocument();
});
test('deleting the last row of the final page returns to the preceding page', async () => {
  const api = setup([row(), row({ id: 'second' })]);
  await screen.findByRole('table');
  api.records.mockResolvedValue({ rows: [row({ id: 'second' })], count: 2, active: false });
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await waitFor(() => expect(api.records).toHaveBeenCalledWith('owner', 1, 1, false));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '删除 综合分析' })).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '删除 综合分析' }));
  api.records.mockImplementation(async (_user, page) => ({ rows: page === 0 ? [row()] : [], count: 1, active: false }));
  fireEvent.click(screen.getByRole('button', { name: '移入回收站' }));
  await waitFor(() => expect(api.records).toHaveBeenLastCalledWith('owner', 0, 1, false));
  await screen.findByRole('button', { name: '删除 综合分析' });
});

test('permanent deletion is confirmed only from trash and failures remain retryable', async () => {
  const api = setup([row()]);
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: '永久删除 综合分析' })).not.toBeInTheDocument();
  api.records.mockResolvedValue({ rows: [row({ deleted_at: 'now' })], count: 1, active: false });
  fireEvent.click(screen.getByRole('button', { name: '回收站' }));
  fireEvent.click(await screen.findByRole('button', { name: '永久删除 综合分析' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('无法恢复');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(api.permanentlyDeleteReport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '永久删除 综合分析' }));
  api.permanentlyDeleteReport.mockRejectedValueOnce(new Error('secret details'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '永久删除' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('删除未完成');
  expect(screen.queryByText('secret details')).not.toBeInTheDocument();
  api.records.mockResolvedValue({ rows: [], count: 0, active: false });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '永久删除' }));
  await screen.findByText('回收站为空。');
  expect(api.permanentlyDeleteReport).toHaveBeenCalledWith('report-1');
});
test('a partially deleted report cannot be restored and exposes a retry action', async () => {
  const api = setup([]);
  await screen.findByRole('table');
  api.records.mockResolvedValue({ rows: [row({ deleted_at: 'now', purge_started_at: 'now', report: null })], count: 1, active: false });
  fireEvent.click(screen.getByRole('button', { name: '回收站' }));
  expect(await screen.findByRole('button', { name: '恢复 综合分析' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '永久删除 综合分析' })).toHaveTextContent('重试删除');
});
