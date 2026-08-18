import type React from 'react';
import { Bell, CalendarClock, CheckCircle2, CircleAlert, Layers3 } from 'lucide-react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { HistoryItem } from '../../types/analysis';
import { formatDateTime } from '../../utils/format';
import { Badge, Button, Card } from '../common';
import { DashboardStateBlock } from '../dashboard';

interface CompositeHistoryViewProps {
  currentRecordId?: number;
  items: HistoryItem[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error?: unknown;
  onClose: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onSelectRecord: (recordId: number) => void;
}

const marketTone = (status?: string | null): 'success' | 'danger' | 'default' => (
  status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'default'
);

export const CompositeHistoryView: React.FC<CompositeHistoryViewProps> = ({
  currentRecordId,
  items,
  total,
  hasMore,
  isLoading,
  isLoadingMore,
  error,
  onClose,
  onLoadMore,
  onRetry,
  onSelectRecord,
}) => {
  const { t } = useUiLanguage();

  return (
    <div className="space-y-4 animate-fade-in" data-testid="composite-history-view">
      <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-card via-card to-primary/5 p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t('compositeHistory.title')}</h2>
              <p className="mt-1 text-sm text-secondary-text">{t('compositeHistory.description', { count: total })}</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>{t('compositeHistory.back')}</Button>
        </div>
      </Card>

      {isLoading ? (
        <DashboardStateBlock loading title={t('compositeHistory.loading')} />
      ) : error ? (
        <DashboardStateBlock
          title={t('compositeHistory.loadFailed')}
          description={t('compositeHistory.loadFailedDescription')}
          action={<Button variant="secondary" size="sm" onClick={onRetry}>{t('common.retry')}</Button>}
        />
      ) : items.length === 0 ? (
        <DashboardStateBlock
          title={t('compositeHistory.empty')}
          description={t('compositeHistory.emptyDescription')}
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const summary = item.compositeSummary;
            const codes = summary?.stockCodes ?? [];
            const failed = summary?.failedStocks ?? [];
            const successCount = Math.max(codes.length - failed.length, 0);
            const selected = item.id === currentRecordId;
            const marketStatus = summary?.marketReviewStatus;
            return (
              <Card
                key={item.id}
                className={`relative overflow-hidden border-subtle p-0 transition-colors ${selected ? 'border-primary/45 bg-primary/5' : 'hover:border-primary/25'}`}
              >
                <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(12rem,1.1fr)_minmax(18rem,2fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Layers3 className="h-4 w-4 text-primary" />
                      <p className="font-semibold text-foreground">{formatDateTime(item.createdAt)}</p>
                      {selected ? <Badge variant="info">{t('compositeHistory.current')}</Badge> : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-text">{t('compositeHistory.model')}</p>
                    <p className="mt-0.5 truncate text-sm text-secondary-text" title={item.modelUsed || t('compositeHistory.modelUnknown')}>
                      {item.modelUsed || t('compositeHistory.modelUnknown')}
                    </p>
                  </div>

                  <div className="min-w-0 space-y-2.5">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" />{t('compositeHistory.successCount', { count: successCount })}</Badge>
                      <Badge variant={failed.length ? 'warning' : 'default'}><CircleAlert className="mr-1 h-3 w-3" />{t('compositeHistory.failedCount', { count: failed.length })}</Badge>
                      <Badge variant={marketTone(marketStatus)}>{marketStatus === 'completed' ? t('compositeHistory.marketCompleted') : marketStatus === 'failed' ? t('compositeHistory.marketFailed') : t('compositeHistory.marketUnknown')}</Badge>
                      <Badge variant={summary?.notificationRequested ? 'info' : 'default'}><Bell className="mr-1 h-3 w-3" />{summary?.notificationRequested === true ? t('compositeHistory.notificationRequested') : summary?.notificationRequested === false ? t('compositeHistory.notificationDisabled') : t('compositeHistory.notificationUnknown')}</Badge>
                    </div>
                    <p className="truncate text-sm text-secondary-text" title={codes.join('、')}>
                      {codes.length ? codes.join('、') : item.analysisSummary || t('compositeHistory.scopeUnknown')}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-4 lg:justify-end">
                    <div className="text-right">
                      <p className="text-xs text-muted-text">{t('compositeHistory.score')}</p>
                      <p className="mt-0.5 text-lg font-semibold text-foreground">{typeof item.sentimentScore === 'number' ? `${Math.round(item.sentimentScore)} / 100` : '--'}</p>
                    </div>
                    <Button variant="home-action-ai" size="sm" onClick={() => onSelectRecord(item.id)}>
                      {t('compositeHistory.viewReport')}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          {hasMore ? (
            <div className="flex justify-center pt-1">
              <Button variant="secondary" size="sm" disabled={isLoadingMore} isLoading={isLoadingMore} onClick={onLoadMore}>
                {t('compositeHistory.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
