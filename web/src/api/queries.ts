import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { Category, Product, Supplier, Unit } from "../types";

export function useProducts(activeOnly = true) {
  return useQuery({
    queryKey: ["products", activeOnly],
    queryFn: async () => (await api.get<Product[]>("/masters/products", { params: activeOnly ? { active: "true" } : {} })).data,
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
