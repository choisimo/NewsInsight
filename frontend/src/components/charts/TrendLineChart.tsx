import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

export interface TrendDataPoint {
  date: string;
  count: number;
}

export interface TrendLineChartProps {
  data: TrendDataPoint[];
  title?: string;
  showArea?: boolean;
  color?: string;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

export const TrendLineChart = forwardRef<ChartExportHandle, TrendLineChartProps>(
  ({ data, title = '시간대별 트렌드', showArea = true, color = 'rgb(59, 130, 246)', className }, ref) => {
    const chartRef = useRef<ChartJS<'line'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    const chartData = {
      labels: data.map((d) => d.date),
      datasets: [
        {
          label: '기사 수',
          data: data.map((d) => d.count),
          borderColor: color,
          backgroundColor: showArea ? `${color}33` : 'transparent',
          fill: showArea,
          tension: 0.4,
          pointBackgroundColor: color,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    };

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: true,
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
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => `${context.parsed.y}건`,
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            maxRotation: 45,
            minRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.1)',
          },
          ticks: {
            precision: 0,
          },
        },
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
    };

    return (
      <div className={className}>
        <Line ref={chartRef} data={chartData} options={options} />
      </div>
    );
  }
);

TrendLineChart.displayName = 'TrendLineChart';
