import { ChevronRight } from 'lucide-react';
import type React from 'react';
import { Link } from 'react-router-dom';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { HistoryItem } from '../../types/analysis';
import { getSentimentColor } from '../../types/analysis';
import { buildDecisionActionLabelMap, getDecisionActionLabel } from '../../utils/decisionAction';
import { formatDateTime } from '../../utils/format';
import { getMarketPhaseSummaryLabel } from '../../utils/marketPhase';
import { truncateStockName } from '../../utils/stockName';

const isMarketReview = (item: HistoryItem): boolean =>
  item.stockCode === 'MARKET' || item.reportType === 'market_review';

const isComposite = (item: HistoryItem): boolean =>
  item.stockCode === 'COMPOSITE' || item.reportType === 'composite_analysis';

export const MobileHistoryCard: React.FC<{ item: HistoryItem }> = ({ item }) => {
  const { language, t } = useUiLanguage();
  const market = isMarketReview(item);
  const composite = isComposite(item);
  const score = typeof item.sentimentScore === 'number' ? item.sentimentScore : null;
  const accentColor = market ? '#f59e0b' : score !== null ? getSentimentColor(score) : null;
  const stockName = item.stockName
    || (composite ? t('home.compositeAnalysis') : market ? t('home.marketReview') : item.stockCode);
  const actionLabels = buildDecisionActionLabelMap(t);
  const operationLabel = getDecisionActionLabel(
    item.action,
    item.actionLabel,
    item.operationAdvice,
    null,
    actionLabels,
  );
  const phaseLabel = getMarketPhaseSummaryLabel(item.marketPhaseSummary, language)
    ?.replace('市场阶段: ', '')
    .replace('市场阶段：', '')
    .replace('Market phase: ', '');

  return (
    <Link
      aria-label={t('history.itemAria', { name: stockName, code: item.stockCode })}
      to={`/m/reports/${item.id}`}
      className="block rounded-2xl border border-border/70 bg-card px-4 py-3.5 shadow-sm active:bg-hover"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-9 w-1 shrink-0 rounded-full bg-subtle"
          style={accentColor ? { backgroundColor: accentColor, boxShadow: `0 0 10px ${accentColor}40` } : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[15px] font-bold text-foreground">{truncateStockName(stockName)}</h3>
            {market ? (
              <span
                className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none"
                style={{ color: accentColor ?? '#f59e0b', borderColor: `${accentColor ?? '#f59e0b'}30`, backgroundColor: `${accentColor ?? '#f59e0b'}10` }}
              >
                {t('stockBar.market')}
              </span>
            ) : score !== null && operationLabel ? (
              <span
                className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none"
                style={{ color: accentColor ?? undefined, borderColor: `${accentColor ?? '#888'}30`, backgroundColor: `${accentColor ?? '#888'}10` }}
              >
                {operationLabel} {score}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-text">
            {!market && !composite ? (
              <>
                <span className="font-mono">{item.stockCode}</span>
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-subtle" />
              </>
            ) : null}
            <span>{formatDateTime(item.createdAt)}</span>
            {phaseLabel ? (
              <>
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-subtle" />
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-secondary-text">{phaseLabel}</span>
              </>
            ) : null}
          </div>
        </div>
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-text" />
      </div>
    </Link>
  );
};