import type React from 'react';
import { BarChart3, Bell, CheckCircle2, CircleAlert, Gauge, ListChecks, Percent, Sparkles } from 'lucide-react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { AnalysisReport } from '../../types/analysis';
import { formatDateTime } from '../../utils/format';
import { Card } from '../common';

interface CompositeAnalysisReportViewProps {
  report: AnalysisReport;
}

const asStringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
);

const asOptionalBoolean = (value: unknown): boolean | undefined => (
  typeof value === 'boolean' ? value : undefined
);

export const CompositeAnalysisReportView: React.FC<CompositeAnalysisReportViewProps> = ({ report }) => {
  const { t } = useUiLanguage();
  const snapshot = report.details?.contextSnapshot ?? {};
  const stockCodes = asStringArray(snapshot.stockCodes);
  const failedStocks = asStringArray(snapshot.failedStocks);
  const successfulCount = Math.max(stockCodes.length - failedStocks.length, 0);
  const successRate = stockCodes.length ? Math.round((successfulCount / stockCodes.length) * 100) : 0;
  const compositeScore = typeof report.summary.sentimentScore === 'number' ? Math.round(report.summary.sentimentScore) : null;
  const marketStatus = typeof snapshot.marketReviewStatus === 'string' ? snapshot.marketReviewStatus : 'unknown';
  const notificationRequested = asOptionalBoolean(snapshot.notificationRequested);
  const isPartial = failedStocks.length > 0 || marketStatus === 'failed';

  const overallLabel = isPartial ? t('home.compositeSummaryPartial') : t('home.compositeSummaryCompleted');
  const marketLabel = marketStatus === 'completed'
    ? t('home.compositeSummaryCompleted')
    : marketStatus === 'failed'
      ? t('home.compositeSummaryFailed')
      : t('home.compositeSummaryUnknown');
  const notificationLabel = notificationRequested === true
    ? t('home.compositeSummaryEnabled')
    : notificationRequested === false
      ? t('home.compositeSummaryDisabled')
      : t('home.compositeSummaryUnknown');
  const languageLabel = report.meta.reportLanguage === 'en'
    ? t('home.compositeSummaryLanguageEn')
    : report.meta.reportLanguage === 'ko'
      ? t('home.compositeSummaryLanguageKo')
      : t('home.compositeSummaryLanguageZh');

  return (
    <article className="space-y-4" data-testid="composite-analysis-report">
      <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-card via-card to-primary/5 p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-[0.14em] text-primary">{t('home.compositeReportLabel')}</p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">{report.meta.stockName || t('home.compositeAnalysis')}</h2>
              <p className="mt-1 text-xs text-muted-text">{formatDateTime(report.meta.createdAt)}</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${isPartial ? 'border-warning/30 bg-warning/10 text-warning' : 'border-success/30 bg-success/10 text-success'}`}>
            {isPartial ? <CircleAlert className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {overallLabel}
          </span>
        </div>
        {report.summary.analysisSummary ? (
          <div className="border-t border-border/70 px-5 py-4">
            <p className="text-xs font-medium text-muted-text">{t('home.compositeSummaryExecution')}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-secondary-text">{report.summary.analysisSummary}</p>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex items-center gap-4 border-subtle p-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs text-muted-text">{t('home.compositeSummaryStocks')}</p>
            <p className="mt-0.5 text-lg font-semibold text-foreground">{successfulCount} / {stockCodes.length}</p>
            <p className={`text-xs ${failedStocks.length ? 'text-warning' : 'text-secondary-text'}`}>
              {t('home.compositeSummaryFailedCount', { count: failedStocks.length })}
            </p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 border-subtle p-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
            <Percent className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs text-muted-text">{t('home.compositeSummarySuccessRate')}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{successRate}%</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 border-subtle p-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs text-muted-text">{t('home.compositeSummaryMarket')}</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{marketLabel}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 border-subtle p-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
            <Gauge className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs text-muted-text">{t('home.compositeSummaryScore')}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {compositeScore === null ? t('home.compositeSummaryUnknown') : `${compositeScore} / 100`}
            </p>
          </div>
        </Card>
      </div>

      <Card className="border-subtle p-5">
        <h3 className="text-sm font-semibold text-foreground">{t('home.compositeSummaryRunInfo')}</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-text">{t('home.compositeSummaryScope')}</dt>
            <dd className="mt-2 flex flex-wrap gap-2">
              {stockCodes.length ? stockCodes.map((code) => (
                <span key={code} className="rounded-lg border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-xs font-medium text-secondary-text">{code}</span>
              )) : <span className="text-sm text-secondary-text">{t('home.compositeSummaryUnknown')}</span>}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-text"><Bell className="h-3.5 w-3.5" />{t('home.compositeSummaryNotification')}</dt>
            <dd className="mt-1 text-sm text-secondary-text">{notificationLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('home.compositeSummaryLanguage')}</dt>
            <dd className="mt-1 text-sm text-secondary-text">{languageLabel}</dd>
          </div>
          {failedStocks.length ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-text">{t('home.compositeSummaryFailedStocks')}</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {failedStocks.map((code) => (
                  <span key={code} className="rounded-lg border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">{code}</span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>
    </article>
  );
};
