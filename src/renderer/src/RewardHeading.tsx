import { Gem } from "lucide-react";
import type { ChatReward } from "../../shared/chat";
export function RewardHeading({ reward }: { reward: ChatReward }) {
  return <div className="chat-reward-heading">
    {reward.imageUrl ? <img src={reward.imageUrl} alt="" /> : <Gem size={16} aria-hidden="true" />}
    <span>Redeemed <strong>{reward.title || "a channel points reward"}</strong></span>
    {reward.cost !== undefined && <small>{reward.cost.toLocaleString()} points</small>}
  </div>;
}
