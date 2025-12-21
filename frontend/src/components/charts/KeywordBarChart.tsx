import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export interface KeywordBarChartProps {
  keywords: Array<{ keyword: string; count: number }>;
  title?: string;
  maxItems?: number;
  horizontal?: boolean;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

export const KeywordBarChart = forwardRef<ChartExportHandle, KeywordBarChartProps>(
  ({ keywords, title = '주요 키워드', maxItems = 10, horizontal = true, className }, ref) => {
    const chartRef = useRef<ChartJS<'bar'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    // Sort and limit keywords
    const sortedKeywords = [...keywords]
      .sort((a, b) => b.count - a.count)
      .slice(0, maxItems);

    const data = {
      labels: sortedKeywords.map((k) => k.keyword),
      datasets: [
        {
          label: '언급 횟수',
          data: sortedKeywords.map((k) => k.count),
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    };

    const options: ChartOptions<'bar'> = {
      responsive: true,
      maintainAspectRatio: true,
      indexAxis: horizontal ? 'y' : 'x',
      plugins: {
        legend: {
          display: false,
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
            label: (context) => `${context.parsed.x || context.parsed.y}건`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: {
            display: !horizontal,
          },
          ticks: {
            precision: 0,
          },
        },
        y: {
          grid: {
            display: horizontal,
          },
          ticks: {
            font: {
              size: 11,
            },
          },
        },
      },
    };

    return (
      <div className={className}>
        <Bar ref={chartRef} data={data} options={options} />
      </div>
    );
  }
);

KeywordBarChart.displayName = 'KeywordBarChart';
