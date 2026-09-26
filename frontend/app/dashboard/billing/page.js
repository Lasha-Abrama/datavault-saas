"use client";
import { useState } from "react";
import { ArrowRight, Check, CreditCard, Layers3 } from "lucide-react";
import { request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import { date, money } from "@/lib/utils";
import {
  Alert,
  Badge,
  Button,
  Confirm,
  ErrorState,
  Loading,
  PageHeading,
  Progress,
  useToast,
} from "@/components/ui";
import { useWorkspace } from "@/components/layout/shell";
export default function Billing() {
  const { isAdmin } = useAuth(),
    workspace = useWorkspace(),
    toast = useToast();
  const billing = useResource(
      (signal) => request("/subscriptions/current/billing", { signal }),
      [],
    ),
    plans = useResource(
      (signal) => request("/plans", { signal, public: true }),
      [],
    );
  const [chosen, setChosen] = useState(null),
    b = billing.data;
  const rank = { free: 0, basic: 1, premium: 2 };
  return (
    <>
      <PageHeading
        eyebrow="ROOM FOR WHAT’S NEXT"
        title="A plan that grows with you."
        description="Know your usage. Understand your costs. Keep moving forward."
      />
      <Alert type="info">
        Plan changes update your workspace’s subscription. Payments are not
        currently collected. Amounts below are internal estimates, not invoices.
      </Alert>
      {billing.loading ? (
        <Loading label="Loading billing details" />
      ) : billing.error ? (
        <ErrorState error={billing.error} retry={billing.reload} />
      ) : (
        <>
          <section className="billing-overview">
            <div className="billing-plan">
              <span className="eyebrow">YOUR CURRENT PLAN</span>
              <h2>
                {b.plan.name}
                <Badge tone="green">Current plan</Badge>
              </h2>
              <p>{money(b.baseAmountCents)} monthly base price</p>
              <div className="billing-period">
                <span>Current billing period</span>
                <strong>
                  {date(b.billingPeriod.startsAt)} —{" "}
                  {date(b.billingPeriod.endsAt)}
                </strong>
                <small>Next period begins {date(b.billingPeriod.endsAt)}</small>
              </div>
            </div>
            <div className="billing-usage">
              <div className="between">
                <h3>Monthly file usage</h3>
                <strong>
                  {b.successfulUploads} / {b.includedUploadAllowance}
                </strong>
              </div>
              <Progress
                value={b.successfulUploads}
                max={b.includedUploadAllowance}
                label="Monthly file allowance"
              />
              <p>
                {b.plan.code === "premium"
                  ? "1,000 included files + $0.50 per additional file."
                  : `${b.includedUploadAllowance} included files per billing period.`}
              </p>
              <div className="between">
                <span>Employees</span>
                <strong>
                  {b.employeeCount}
                  {b.plan.maxEmployees !== null
                    ? ` / ${b.plan.maxEmployees}`
                    : " / Unlimited"}
                </strong>
              </div>
              <p>
                {b.plan.code === "basic"
                  ? "$5/month per employee. The company owner is not billed as an employee."
                  : b.plan.code === "free"
                    ? "One company owner included. Upgrade to invite employees."
                    : "Unlimited employees included in your monthly base price."}
              </p>
            </div>
          </section>
          <section className="panel cost-panel">
            <div>
              <span className="eyebrow">CURRENT PERIOD ESTIMATE</span>
              <h2>
                {money(b.totalAmountCents)}
                <small> USD</small>
              </h2>
              <p>Based on your current plan and recorded usage.</p>
            </div>
            <dl className="cost-lines">
              <div>
                <dt>Monthly base</dt>
                <dd>{money(b.baseAmountCents)}</dd>
              </div>
              <div>
                <dt>
                  {b.billableEmployeeCount} billable employees ×{" "}
                  {money(b.employeeUnitPriceCents)}
                </dt>
                <dd>{money(b.employeeChargeCents)}</dd>
              </div>
              <div>
                <dt>
                  {b.billableOverageUploads} recorded additional files ×{" "}
                  {money(b.overageUnitPriceCents)}
                </dt>
                <dd>{money(b.overageChargeCents)}</dd>
              </div>
              <div className="total">
                <dt>Estimated total</dt>
                <dd>{money(b.totalAmountCents)}</dd>
              </div>
            </dl>
          </section>
          {b.planChangedInCurrentPeriod && (
            <Alert type="info">
              Your plan changed this period. This estimate uses your current
              plan plus any previously recorded file overage.
            </Alert>
          )}
        </>
      )}
      <div className="section-heading">
        <span className="eyebrow">BUILT AROUND YOUR WORKSPACE</span>
        <h2>More space for your next chapter.</h2>
        <p>Compare the plans. Find your fit.</p>
      </div>
      {plans.loading ? (
        <Loading label="Loading available plans" />
      ) : plans.error ? (
        <ErrorState error={plans.error} retry={plans.reload} />
      ) : (
        <section className="plan-grid">
          {plans.data.map((plan, i) => {
            const current = b?.plan.code === plan.code;
            return (
              <article
                className={`plan-card ${current ? "current" : ""}`}
                key={plan.code}
              >
                <div className="between">
                  <span className="plan-index">0{i + 1}</span>
                  {current && (
                    <Badge tone="green">
                      <Check size={12} />
                      Your plan
                    </Badge>
                  )}
                </div>
                <h3>{plan.name}</h3>
                <p>
                  {plan.code === "free"
                    ? "A focused start for your data."
                    : plan.code === "basic"
                      ? "A shared space for a growing team."
                      : "Built for your next stage of scale."}
                </p>
                <div className="plan-price">
                  {money(
                    plan.code === "basic"
                      ? plan.employeePriceCents
                      : plan.basePriceCents,
                  )}
                  <span>
                    {plan.code === "basic" ? "/ employee / month" : "/ month"}
                  </span>
                </div>
                <div className="plan-allowance">
                  <strong>{plan.includedFilesPerMonth.toLocaleString()}</strong>
                  <span>files per month</span>
                  <div
                    className={`allowance-ticks ticks-${plan.code}`}
                    aria-hidden="true"
                  >
                    {Array.from({ length: 20 }, (_, j) => (
                      <i key={j} />
                    ))}
                  </div>
                </div>
                <ul>
                  <li>
                    <Check size={15} />
                    {plan.maxEmployees === null
                      ? "Unlimited employees"
                      : plan.maxEmployees === 0
                        ? "1 user · Company owner"
                        : `Up to ${plan.maxEmployees} employees`}
                  </li>
                  <li>
                    <Check size={15} />
                    Company and restricted file access
                  </li>
                  <li>
                    <Check size={15} />
                    {plan.extraFilePriceCents === null
                      ? "Monthly file allowance"
                      : `${money(plan.extraFilePriceCents)} per additional file`}
                  </li>
                </ul>
                {isAdmin ? (
                  <Button
                    variant={
                      current
                        ? "secondary"
                        : plan.code === "premium"
                          ? "primary"
                          : "secondary"
                    }
                    className="full"
                    disabled={current || !b}
                    onClick={() => setChosen(plan)}
                  >
                    {current
                      ? "Current plan"
                      : `${rank[plan.code] > rank[b?.plan.code] ? "Upgrade" : "Downgrade"} to ${plan.name}`}
                    {!current && <ArrowRight size={15} />}
                  </Button>
                ) : (
                  <p className="small muted">
                    Your administrator manages this plan.
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}
      {chosen && (
        <Confirm
          title={`Change to ${chosen.name}?`}
          description={`Your workspace will use the ${chosen.name} plan with ${chosen.includedFilesPerMonth.toLocaleString()} included files per month. ${chosen.code === "basic" ? "$5 per employee per month." : `${money(chosen.basePriceCents)} monthly base.`} No payment will be collected. Downgrades must accommodate employees and pending invitations.`}
          label="Confirm plan change"
          dangerous={false}
          onClose={() => setChosen(null)}
          onConfirm={async () => {
            await request("/subscriptions/current", {
              method: "PATCH",
              body: { planCode: chosen.code },
            });
            toast(`Your plan is now ${chosen.name}`);
            billing.reload();
            workspace.reload();
          }}
        />
      )}
    </>
  );
}
