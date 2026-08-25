import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useAgentChatStore } from '../../../stores/agentChatStore';
import MobileChatPage from '../MobileChatPage';

vi.mock('../../../stores/agentChatStore', () => ({ useAgentChatStore: vi.fn() }));

describe('MobileChatPage', () => {
  it('renders the conversation and sends a stock-aware question through the shared chat store', () => {
    const startStream = vi.fn();
    vi.mocked(useAgentChatStore).mockReturnValue({
      messages: [{ id: '1', role: 'assistant', content: '请告诉我想分析的股票。' }],
      selectedSkillIds: ['stock-analysis'], loading: false, progressSteps: [], sessionId: 's1', sessions: [], sessionsLoading: false,
      chatError: null, currentRoute: '/m/chat', completionBadge: false, hasInitialLoad: true, abortController: null,
      activeRequestId: null, serverCancellation: false, stopping: false, terminalStatus: null, stopError: false,
      setSelectedSkillIds: vi.fn(), setCurrentRoute: vi.fn(), clearCompletionBadge: vi.fn(), loadSessions: vi.fn(), loadInitialSession: vi.fn(), switchSession: vi.fn(), startNewChat: vi.fn(), stopStream: vi.fn(), startStream,
    });
    render(<MemoryRouter><MobileChatPage /></MemoryRouter>);
    expect(screen.getByText('请告诉我想分析的股票。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('问股内容'), { target: { value: '分析 600519 的风险' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(startStream).toHaveBeenCalledWith(expect.objectContaining({ message: '分析 600519 的风险', session_id: 's1', skills: ['stock-analysis'] }), expect.any(Object));
  });
});
