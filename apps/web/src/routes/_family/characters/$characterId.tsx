import { NotAuthenticated, NotFound, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { CharacterForm } from "~/components/character-form";
import { CharacterResult, getCharacterFn } from "~/server/books";

export const Route = createFileRoute("/_family/characters/$characterId")({
  loader: async ({ params }) => {
    try {
      return unwrapResult(CharacterResult)(await getCharacterFn({ data: { characterId: params.characterId } }));
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      if (error instanceof NotFound) throw notFound();
      throw error;
    }
  },
  component: function EditCharacter() {
    const { character, canEdit } = Route.useLoaderData();
    // Keyed by character, so moving between characters starts the form afresh.
    return <CharacterForm key={character.id} character={character} canEdit={canEdit} />;
  },
});
