import { StyleSheet } from "react-native";

export const authStyles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#12372A",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    gap: 14,
    maxWidth: 480,
    padding: 22,
    width: "100%"
  },
  copy: { color: "#526158", fontSize: 14, lineHeight: 20 },
  error: { color: "#A12622", fontSize: 14, lineHeight: 20 },
  field: { gap: 6 },
  input: {
    borderColor: "#AAB5AE",
    borderRadius: 9,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12
  },
  label: { color: "#24342A", fontSize: 14, fontWeight: "700" },
  link: { color: "#175C43", fontSize: 14, fontWeight: "700", textAlign: "center" },
  page: {
    alignItems: "center",
    backgroundColor: "#EDF3EF",
    flexGrow: 1,
    justifyContent: "center",
    padding: 20
  },
  success: { color: "#176B45", fontSize: 14, lineHeight: 20 },
  title: { color: "#12372A", fontSize: 28, fontWeight: "900" }
});
