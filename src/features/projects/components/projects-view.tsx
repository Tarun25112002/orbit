"use client";
import { Poppins } from "next/font/google";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SparkleIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { ProjectsList } from "./projects-list";
import { useCreateProject } from "../hooks/use-projects";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator
} from "unique-names-generator"
const font = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
export const ProjectsView = () => {
    const createProject = useCreateProject();

  return (
    <>
      <div>
        <div>
          <div>
            <div>
              <img src="" alt="Orbit" />
              <h1
                className={cn(
                  "text-4xl md:text-5xl font-semibold",
                  font.className,
                )}
              >
                Orbit
              </h1>
            </div>
          </div>
          <div className="flex flex-col gap-4 w-full">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => {const projectName = uniqueNamesGenerator({
                dictionaries: [adjectives, animals, colors],
                separator: "_",
                length: 3
              }); createProject({
                name: projectName
              })}} className="w-full">
                <div>
                  <SparkleIcon />
                  <Kbd>ctrl+j</Kbd>
                </div>
                <div>
                  <span>New</span>
                </div>
              </Button>
              <Button variant="outline" onClick={() => {}} className="w-full">
                <div>
                  <SparkleIcon />
                  <Kbd>ctrl+j</Kbd>
                </div>
                <div>
                  <span>GitHub</span>
                </div>
              </Button>
            </div>
            <ProjectsList onViewAll={()=>{}}/>
          </div>
        </div>
      </div>
    </>
  );
};
