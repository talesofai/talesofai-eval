import type { AxiosInstance } from "axios";
import type { CharacterAssign } from "./types.ts";

export interface CharacterFromSelect {
  uuid: string;
  name: string;
  biography: {
    age: string;
    persona: string;
    interests: string;
    occupation: string;
    description: string;
  };
  config: {
    avatar_img: string;
  };
}

export const createCharacterApis = (client: AxiosInstance) => {
  const getRandomCharacters = async (num: number) =>
    client
      .get<CharacterFromSelect[]>(
        `/v1/collection-interactive/char_roll?num=${num}`,
      )
      .then((res) => res.data);

  return { getRandomCharacters };
};

export const mapToCharacterAssign = (
  char: CharacterFromSelect,
): CharacterAssign => ({
  type: "character",
  uuid: char.uuid,
  name: char.name,
  age: char.biography?.age ?? null,
  interests: char.biography?.interests ?? null,
  persona: char.biography?.persona ?? null,
  description: char.biography?.description ?? null,
  occupation: char.biography?.occupation ?? null,
  avatar_img: char.config?.avatar_img ?? null,
});
