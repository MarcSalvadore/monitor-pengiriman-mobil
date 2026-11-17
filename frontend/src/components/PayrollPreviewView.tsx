import { Calculator } from 'lucide-react';
import { useMemo } from 'react';
import { formatIdr } from '../lib/utils/offlineCalculator';
import type { DeliveryLog, Driver } from '../types/domain';

interface PayrollPreviewViewProps {
  drivers: Driver[];
  deliveries: DeliveryLog[];
}

export function PayrollPreviewView({
  drivers,
  deliveries,
}: PayrollPreviewViewProps) {
  const summaries = useMemo(() => {
    return drivers.map((driver) => {
      const driverTrips = deliveries.filter(
        (d) => d.driver_id === driver.id && d.status !== 'voided'
      );
      const totalDistanceKm = driverTrips.reduce(
        (sum, t) => sum + Number(t.computed_distance_km),
        0
      );
      const totalVariableBenefit = driverTrips.reduce(
        (sum, t) => sum + Number(t.calculated_benefit_amount),
        0
      );
      const totalPayout =
        Number(driver.base_fixed_salary) + totalVariableBenefit;

      return {
        driver,
        totalTrips: driverTrips.length,
        totalDistanceKm,
        totalVariableBenefit,
        totalPayout,
      };
    });
  }, [drivers, deliveries]);

  const grandTotalPayout = summaries.reduce((sum, s) => sum + s.totalPayout, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Driver Payroll Settlement Preview
            </h2>
            <p className="text-xs text-slate-400">
              Live summary computed from verified delivery logs (voided trips excluded)
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-right tabular-nums">
          <p className="text-[11px] uppercase tracking-wider text-emerald-300/80">
            Total Fleet Payroll
          </p>
          <p className="text-base font-bold text-emerald-300">
            {formatIdr(grandTotalPayout)}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-left text-xs sm:text-sm">
            <thead className="bg-slate-950/70 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Base Branch</th>
                <th className="px-4 py-3 text-right">Trips</th>
                <th className="px-4 py-3 text-right">Distance</th>
                <th className="px-4 py-3 text-right">Base Salary</th>
                <th className="px-4 py-3 text-right">Delivery Benefits</th>
                <th className="px-4 py-3 text-right">Total Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 tabular-nums">
              {summaries.map((item) => (
                <tr key={item.driver.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-100">
                      {item.driver.full_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {item.driver.employee_code}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {item.driver.base_shop_code || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-200">
                    {item.totalTrips}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-200">
                    {item.totalDistanceKm.toFixed(2)} km
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {formatIdr(item.driver.base_fixed_salary)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-sky-300">
                    {formatIdr(item.totalVariableBenefit)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-400">
                    {formatIdr(item.totalPayout)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
