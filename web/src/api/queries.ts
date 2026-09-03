import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { BillingAccount, Category, Product, Supplier, Unit } from "../types";

export function useProducts(activeOnly = true) {
  return useQuery({
    queryKey: ["products", activeOnly],
    queryFn: async () => (await api.get<Product[]>("/masters/products", { params: activeOnly ? { active: "true" } : {} })).data,
  });
}

export function useStoreProducts(activeOnly = true) {
  return useQuery({
    queryKey: ["products", "store", activeOnly],
    queryFn: async () => (await api.get<Product[]>("/masters/products", { params: { storeOnly: "true", ...(activeOnly ? { active: "true" } : {}) } })).data,
  });
}

/** Sellable products for POS / OT orders: only those with a price (raw
 * materials, which have no price, are excluded). */
export function useSellableProducts() {
  return useQuery({
    queryKey: ["products", "sellable"],
    queryFn: async () => (await api.get<Product[]>("/masters/products", { params: { active: "true", sellable: "true" } })).data,
  });
}

/** Food items only: priced and non-stock (prepared food). */
export function useFoodItems() {
  return useQuery({
    queryKey: ["products", "food"],
    queryFn: async () => (await api.get<Product[]>("/masters/products", { params: { foodItem: "true" } })).data,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get<Category[]>("/masters/categories")).data,
  });
}

export function useUnits() {
  return useQuery({
    queryKey: ["units"],
    queryFn: async () => (await api.get<Unit[]>("/masters/units")).data,
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await api.get<Supplier[]>("/masters/suppliers")).data,
  });
}

export function useBillingAccounts(params?: { type?: string; activeOnly?: boolean }) {
  return useQuery({
    queryKey: ["billing-accounts", params ?? {}],
    queryFn: async () =>
      (
        await api.get<BillingAccount[]>("/managed/accounts", {
          params: { ...(params?.type ? { type: params.type } : {}), ...(params?.activeOnly ? { active: "true" } : {}) },
        })
      ).data,
  });
}
