/** Agent Skills spec name validation — mirrors crates/services/src/pony.rs `validate_name`. */
export function validateSkillName(name: string): string | null {
  if (!name) return "Name is required";
  if ([...name].length > 64) return "Name must be at most 64 characters";
  if (!/^[a-z0-9-]+$/.test(name)) {
    return "Use only lowercase letters, numbers, and hyphens";
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return "Name cannot start or end with a hyphen";
  }
  if (name.includes("--")) {
    return "Name cannot contain consecutive hyphens";
  }
  return null;
}

export function validateSkillDescription(description: string): string | null {
  const trimmed = description.trim();
  if (!trimmed) return "Description is required";
  if ([...trimmed].length > 1024) {
    return "Description must be at most 1,024 characters";
  }
  return null;
}

export function canSaveSkill(input: {
  name: string;
  description: string;
  compatibility?: string;
}): boolean {
  if (validateSkillName(input.name.trim()) !== null) return false;
  if (validateSkillDescription(input.description) !== null) return false;
  if (input.compatibility && [...input.compatibility.trim()].length > 500) {
    return false;
  }
  return true;
}
