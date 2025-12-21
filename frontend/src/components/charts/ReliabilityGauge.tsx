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

export interface ReliabilityGaugeProps {
  score: number;  // 0-100
  title?: string;
  showLabel?: boolean;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

const getGradeInfo = (score: number) => {
  if (score >= 80) return { label: '높음', color: 'rgba(34, 197, 94, 0.8)', borderColor: 'rgba(34, 197, 94, 1)' };
  if (score >= 50) return { label: '중간', color: 'rgba(234, 179, 8, 0.8)', borderColor: 'rgba(234, 179, 8, 1)' };
  return { label: '낮음', color: 'rgba(239, 68, 68, 0.8)', borderColor: 'rgba(239, 68, 68, 1)' };
};

export const ReliabilityGauge = forwardRef<ChartExportHandle, ReliabilityGaugeProps>(
  ({ score, title = '신뢰도', showLabel = true, className }, ref) => {
    const chartRef = useRef<ChartJS<'doughnut'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    const gradeInfo = getGradeInfo(score);
    const remaining = 100 - score;

    const data = {
      labels: ['신뢰도', ''],
      datasets: [
        {
          data: [score, remaining],
          backgroundColor: [gradeInfo.color, 'rgba(229, 231, 235, 0.5)'],
          borderColor: [gradeInfo.borderColor, 'rgba(229, 231, 235, 0.8)'],
          borderWidth: 2,
          circumference: 270,
          rotation: 225,
        },
      ],
    };

    const options: ChartOptions<'doughnut'> = {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '70%',
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
            bottom: 10,
          },
        },
        tooltip: {
          enabled: false,
        },
      },
    };

    return (
      <div className={`relative ${className}`}>
        <Doughnut ref={chartRef} data={data} options={options} />
        {showLabel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-3xl font-bold" style={{ color: gradeInfo.borderColor }}>
              {score}
            </div>
            <div className="text-sm text-muted-foreground">{gradeInfo.label}</div>
          </div>
        )}
      </div>
    );
  }
);

ReliabilityGauge.displayName = 'ReliabilityGauge';
