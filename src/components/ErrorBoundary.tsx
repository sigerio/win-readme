import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

interface Props {
  children: ReactNode;
}

interface State {
  error: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <div className="workspace-error">{t("renderFailed", { error: this.state.error })}</div>;
    }
    return this.props.children;
  }
}
