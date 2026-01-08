export function getOrCreateUserId() {
    if (typeof window === "undefined") return "server";
    const existing = localStorage.getItem("user_id");
    if (existing) return existing;
  
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now()) + "_" + Math.random().toString(16).slice(2);
  
    localStorage.setItem("user_id", id);
    return id;
  }
  
  export function getDisplayName() {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("display_name") || "";
  }
  
  export function setDisplayName(name: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem("display_name", name);
  }  