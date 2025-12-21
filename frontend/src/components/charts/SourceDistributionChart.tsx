import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

export interface SourceDistributionChartProps {
  sources: Array<{ source: string; count: number }>;
  title?: string;
  maxItems?: number;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

const COLORS = [
  'rgba(59, 130, 246, 0.8)',   // Blue
  'rgba(34, 197, 94, 0.8)',    // Green
  'rgba(234, 179, 8, 0.8)',    // Yellow
  'rgba(239, 68, 68, 0.8)',    // Red
  'rgba(168, 85, 247, 0.8)',   // Purple
  'rgba(20, 184, 166, 0.8)',   // Teal
  'rgba(249, 115, 22, 0.8)',   // Orange
  'rgba(236, 72, 153, 0.8)',   // Pink
  'rgba(107, 114, 128, 0.8)',  // Gray
  'rgba(139, 92, 246, 0.8)',   // Violet
];

const BORDER_COLORS = [
  'rgba(59, 130, 246, 1)',
  'rgba(34, 197, 94, 1)',
  'rgba(234, 179, 8, 1)',
  'rgba(239, 68, 68, 1)',
  'rgba(168, 85, 247, 1)',
  'rgba(20, 184, 166, 1)',
  'rgba(249, 115, 22, 1)',
  'rgba(236, 72, 153, 1)',
  'rgba(107, 114, 128, 1)',
  'rgba(139, 92, 246, 1)',
];

export const SourceDistributionChart = forwardRef<ChartExportHandle, SourceDistributionChartProps>(
  ({ sources, title = '출처별 분포', maxItems = 8, className }, ref) => {
    const chartRef = useRef<ChartJS<'doughnut'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    // Sort and limit sources
    const sortedSources = [...sources]
      .sort((a, b) => b.count - a.count)
      .slice(0, maxItems);

    // Group remaining sources as "기타"
    if (sources.length > maxItems) {
      const otherCount = sources
        .sort((a, b) => b.count - a.count)
        .slice(maxItems)
        .reduce((sum, s) => sum + s.count, 0);
      if (otherCount > 0) {
        sortedSources.push({ source: '기타', count: otherCount });
      }
    }

    const data = {
      labels: sortedSources.map((s) => s.source),
      datasets: [
        {
          data: sortedSources.map((s) => s.count),
          backgroundColor: sortedSources.map((_, i) => COLORS[i % COLORS.length]),
          borderColor: sortedSources.map((_, i) => BORDER_COLORS[i % BORDER_COLORS.length]),
          borderWidth: 2,
        },
      ],
    };

    const options: ChartOptions<'doughnut'> = {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '50%',
      plugins: {
        legend: {
          display: true,
          position: 'right',
          labels: {
            padding: 15,
            usePointStyle: true,
            font: {
              size: 11,
            },
          },
        },
        title: {
          display: !!title,
          text: title,
          font: {
            size: 16,
            weight: 'bold',
          },
          padding: {
            bottom: 20,
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const total = sortedSources.reduce((sum, s) => sum + s.count, 0);
              const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0';
              return `${context.label}: ${context.parsed}건 (${percentage}%)`;
            },
          },
        },
      },
    };

    return (
      <div className={className}>
        <Doughnut ref={chartRef} data={data} options={options} />
      </div>
    );
  }
);

SourceDistributionChart.displayName = 'SourceDistributionChart';
