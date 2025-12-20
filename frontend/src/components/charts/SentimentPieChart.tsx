import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

export interface SentimentPieChartProps {
  positive: number;
  negative: number;
  neutral: number;
  title?: string;
  showLegend?: boolean;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

export const SentimentPieChart = forwardRef<ChartExportHandle, SentimentPieChartProps>(
  ({ positive, negative, neutral, title = '감성 분포', showLegend = true, className }, ref) => {
    const chartRef = useRef<ChartJS<'pie'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    const data = {
      labels: ['긍정', '부정', '중립'],
      datasets: [
        {
          data: [positive, negative, neutral],
          backgroundColor: [
            'rgba(34, 197, 94, 0.8)',   // Green
            'rgba(239, 68, 68, 0.8)',    // Red
            'rgba(156, 163, 175, 0.8)',  // Gray
          ],
          borderColor: [
            'rgba(34, 197, 94, 1)',
            'rgba(239, 68, 68, 1)',
            'rgba(156, 163, 175, 1)',
          ],
          borderWidth: 2,
        },
      ],
    };

    const options: ChartOptions<'pie'> = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: showLegend,
          position: 'bottom',
          labels: {
            padding: 20,
            usePointStyle: true,
            font: {
              size: 12,
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
              const total = positive + negative + neutral;
              const value = context.parsed;
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
              return `${context.label}: ${value}건 (${percentage}%)`;
            },
          },
        },
      },
    };

    return (
      <div className={className}>
        <Pie ref={chartRef} data={data} options={options} />
      </div>
    );
  }
);

SentimentPieChart.displayName = 'SentimentPieChart';
