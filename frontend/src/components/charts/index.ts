/**
 * Chart components for PDF report generation
 * These components use Chart.js and provide a toBase64() method
 * for exporting chart images to be included in PDF reports.
 */

export { SentimentPieChart, type SentimentPieChartProps } from './SentimentPieChart';
export { KeywordBarChart, type KeywordBarChartProps } from './KeywordBarChart';
export { TrendLineChart, type TrendLineChartProps, type TrendDataPoint } from './TrendLineChart';
export { ReliabilityGauge, type ReliabilityGaugeProps } from './ReliabilityGauge';
export { SourceDistributionChart, type SourceDistributionChartProps } from './SourceDistributionChart';

// Common export handle interface
export type { ChartExportHandle } from './SentimentPieChart';
