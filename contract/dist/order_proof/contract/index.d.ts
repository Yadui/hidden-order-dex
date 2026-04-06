import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  submit_order(context: __compactRuntime.CircuitContext<PS>,
               oid_0: string,
               pair_0: string,
               timestamp_0: string,
               settle_hash_0: string,
               price_cents_0: bigint,
               amount_units_0: bigint,
               side_0: bigint,
               nonce_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  settle_order(context: __compactRuntime.CircuitContext<PS>,
               oid_0: string,
               matched_price_cents_0: bigint,
               buyer_limit_0: bigint,
               seller_limit_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  submit_order(context: __compactRuntime.CircuitContext<PS>,
               oid_0: string,
               pair_0: string,
               timestamp_0: string,
               settle_hash_0: string,
               price_cents_0: bigint,
               amount_units_0: bigint,
               side_0: bigint,
               nonce_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  settle_order(context: __compactRuntime.CircuitContext<PS>,
               oid_0: string,
               matched_price_cents_0: bigint,
               buyer_limit_0: bigint,
               seller_limit_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  submit_order(context: __compactRuntime.CircuitContext<PS>,
               oid_0: string,
               pair_0: string,
               timestamp_0: string,
               settle_hash_0: string,
               price_cents_0: bigint,
               amount_units_0: bigint,
               side_0: bigint,
               nonce_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  settle_order(context: __compactRuntime.CircuitContext<PS>,
               oid_0: string,
               matched_price_cents_0: bigint,
               buyer_limit_0: bigint,
               seller_limit_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly order_id: string;
  readonly asset_pair: string;
  readonly order_timestamp: string;
  readonly settlement_hash: string;
  readonly order_status: bigint;
  readonly fairness_proven: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
