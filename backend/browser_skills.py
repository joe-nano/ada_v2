"""
Browser Skills Store - manages reusable browser automation skills
"""
import json
import os
from typing import List, Dict, Optional
from dataclasses import dataclass

@dataclass
class BrowserSkill:
    id: str
    name: str
    description: str
    template: str

class BrowserSkillsStore:
    """Store for managing browser automation skills/templates"""

    def __init__(self, store_path: str = "browser_skills.json"):
        self.store_path = store_path
        self.skills: Dict[str, BrowserSkill] = {}
        self._load()

    def _load(self):
        """Load skills from disk"""
        if os.path.exists(self.store_path):
            try:
                with open(self.store_path, 'r') as f:
                    data = json.load(f)
                    for skill_data in data:
                        skill = BrowserSkill(**skill_data)
                        self.skills[skill.id] = skill
            except Exception as e:
                print(f"[BrowserSkills] Error loading skills: {e}")

    def _save(self):
        """Save skills to disk"""
        try:
            data = [
                {
                    "id": skill.id,
                    "name": skill.name,
                    "description": skill.description,
                    "template": skill.template
                }
                for skill in self.skills.values()
            ]
            with open(self.store_path, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"[BrowserSkills] Error saving skills: {e}")

    def list(self) -> List[BrowserSkill]:
        """List all skills"""
        return list(self.skills.values())

    def save(self, name: str, description: str, template: str) -> BrowserSkill:
        """Save a new skill"""
        import uuid
        skill_id = str(uuid.uuid4())
        skill = BrowserSkill(
            id=skill_id,
            name=name,
            description=description,
            template=template
        )
        self.skills[skill_id] = skill
        self._save()
        return skill

    def delete(self, skill_id: Optional[str] = None, name: Optional[str] = None) -> bool:
        """Delete a skill by ID or name"""
        if skill_id and skill_id in self.skills:
            del self.skills[skill_id]
            self._save()
            return True
        elif name:
            for sid, skill in list(self.skills.items()):
                if skill.name == name:
                    del self.skills[sid]
                    self._save()
                    return True
        return False

    def build_prompt_preamble(self, prompt: str, limit: int = 5) -> str:
        """Build a preamble of relevant skills for a prompt"""
        if not self.skills:
            return ""

        # Simple implementation: return first N skills
        skills = list(self.skills.values())[:limit]
        if not skills:
            return ""

        preamble = "Available browser skills:\n"
        for skill in skills:
            preamble += f"- {skill.name}: {skill.description}\n"
        preamble += "\n"
        return preamble
