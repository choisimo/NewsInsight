import { FactCheckChatbot } from "@/components/FactCheckChatbot";

/**
 * 팩트체크 페이지
 * 
 * 챗봇 인터페이스를 통해 실시간으로 팩트체크를 수행합니다.
 */
export default function FactCheck() {
  return (
    <div className="container mx-auto p-6">
      <FactCheckChatbot />
    </div>
  );
}
